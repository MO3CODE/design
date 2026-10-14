// المهام بالخلفية: التصميم يشتغل على السيرفر مستقل عن المتصفح — تقدر تطلع من الصفحة وترجع وتكمل المتابعة.
// كل منشور له مهمة وحدة نشطة؛ الأحداث تنحفظ (replay) لأي متصفح يتصل بعدين، والتصميم الجماعي بطابور على السيرفر.
import type { Response } from 'express';
import { mutate, findPost, listProjects, uid, now } from './store.js';

export type Emit = (ev: Record<string, any>) => void;
export interface Job {
  id: string; pid: string; postId: string; kind: string; label: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  events: any[]; result?: any; error?: string; createdAt: string; startedAt?: string; endedAt?: string;
  fn: (emit: Emit) => Promise<any>; subs: Set<(ev: any) => void>; cancel: boolean;
}

const jobs = new Map<string, Job>();          // آخر مهمة لكل منشور
const queue: Job[] = [];
let active = 0;
const MAX_PARALLEL = Math.max(1, Number(process.env.JOBS_PARALLEL || 2));
const key = (pid: string, postId: string) => `${pid}:${postId}`;

export class CancelledError extends Error { constructor() { super('أُلغيت المهمة'); } }

export const getJob = (pid: string, postId: string) => jobs.get(key(pid, postId));
export const isBusy = (j?: Job) => !!j && (j.status === 'queued' || j.status === 'running');
export const summary = (j?: Job) => j && ({ id: j.id, kind: j.kind, label: j.label, status: j.status, error: j.error,
  createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, position: j.status === 'queued' ? queue.indexOf(j) + 1 : 0 });

function push(j: Job, ev: any) {
  if (ev.type === 'progress') {   // نحتفظ بآخر تقدم فقط (ما نكبر الذاكرة)
    const last = j.events[j.events.length - 1];
    if (last?.type === 'progress' && last.variant === ev.variant) j.events[j.events.length - 1] = ev; else j.events.push(ev);
  } else j.events.push(ev);
  for (const s of j.subs) s(ev);
}

async function setState(j: Job, state: 'queued' | 'designing' | null) {
  await mutate(j.pid, p => {
    const post = findPost(p, j.postId);
    post.state = state ?? (post.versions.some(v => v.verdict === 'approved' && v.id === post.current) ? 'approved' : post.versions.length ? 'review' : 'new');
  }).catch(() => {});
}

export function startJob(pid: string, postId: string, kind: string, label: string, fn: (emit: Emit) => Promise<any>): Job {
  const old = jobs.get(key(pid, postId));
  if (isBusy(old)) return old!;
  const j: Job = { id: uid(), pid, postId, kind, label, status: 'queued', events: [], createdAt: now(), fn, subs: new Set(), cancel: false };
  jobs.set(key(pid, postId), j);
  queue.push(j);
  setState(j, 'queued');
  push(j, { type: 'queued', position: queue.indexOf(j) + 1, at: Date.now() });
  pump();
  return j;
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const j = queue.shift()!;
    if (j.cancel) continue;
    active++; run(j).finally(() => { active--; pump(); });
  }
  queue.forEach((j, i) => push(j, { type: 'queued', position: i + 1 }));
}

async function run(j: Job) {
  j.status = 'running'; j.startedAt = now();
  await setState(j, 'designing');
  push(j, { type: 'started', label: j.label });
  const emit: Emit = ev => { if (j.cancel) throw new CancelledError(); push(j, { ...ev, at: Date.now() }); };
  try {
    j.result = await j.fn(emit);
    j.status = 'done';
    push(j, { type: 'done', result: j.result });
  } catch (e: any) {
    j.status = e instanceof CancelledError || j.cancel ? 'cancelled' : 'error';
    j.error = e?.message || String(e);
    if (j.status === 'error') console.error(`[job ${j.kind}]`, e);
    push(j, { type: 'error', message: j.status === 'cancelled' ? 'أُلغيت المهمة' : j.error });
  } finally {
    j.endedAt = now();
    await setState(j, null);
    for (const s of j.subs) s({ type: '__end' });
    j.subs.clear();
    // نخلي آخر مهمة 30 دقيقة عشان اللي يرجع يشوف النتيجة/الخطأ
    setTimeout(() => { if (jobs.get(key(j.pid, j.postId)) === j) jobs.delete(key(j.pid, j.postId)); }, 30 * 60e3).unref?.();
  }
}

export function cancelJob(pid: string, postId: string) {
  const j = jobs.get(key(pid, postId));
  if (!j || !isBusy(j)) return false;
  j.cancel = true;
  if (j.status === 'queued') {
    queue.splice(queue.indexOf(j), 1);
    j.status = 'cancelled'; j.endedAt = now();
    push(j, { type: 'error', message: 'أُلغيت المهمة' });
    for (const s of j.subs) s({ type: '__end' }); j.subs.clear();
    setState(j, null);
  }
  return true;
}

/** يبث أحداث المهمة كـ NDJSON: يعيد كل اللي صار ثم المباشر لين تخلص. قطع الاتصال ما يوقف المهمة. */
export function subscribe(j: Job, res: Response) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(JSON.stringify({ type: 'job', job: summary(j) }) + '\n');
  for (const ev of j.events) res.write(JSON.stringify(ev) + '\n');
  if (!isBusy(j)) return res.end();
  const sub = (ev: any) => { if (ev.type === '__end') { j.subs.delete(sub); res.end(); } else res.write(JSON.stringify(ev) + '\n'); };
  j.subs.add(sub);
  const ping = setInterval(() => res.write(JSON.stringify({ type: 'ping' }) + '\n'), 20000);
  res.on('close', () => { clearInterval(ping); j.subs.delete(sub); });
}

export function projectJobs(pid: string) {
  return [...jobs.values()].filter(j => j.pid === pid).map(summary);
}

/** بعد إعادة تشغيل السيرفر: أي منشور كان «يُصمَّم» يرجع لحالته الطبيعية */
export async function resetStaleStates() {
  for (const p of listProjects()) {
    if (!p.posts.some(x => x.state === 'designing' || (x.state as string) === 'queued')) continue;
    await mutate(p.id, pp => { for (const post of pp.posts) if (post.state === 'designing' || (post.state as string) === 'queued')
      post.state = post.versions.length ? 'review' : 'new'; });
  }
}
