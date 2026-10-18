// المهام بالخلفية: التصميم يشتغل على السيرفر مستقل عن المتصفح — تقدر تطلع من الصفحة وترجع وتكمل المتابعة.
// محلياً: طابور بالذاكرة + بث مباشر. على Vercel: كل مهمة تشتغل باستدعاء خاص (waitUntil) وتحفظ تقدمها بالتخزين،
// والمتصفح يتابع بالسحب كل ثانية ونص؛ والتصميم الجماعي يتسلسل ذاتياً (كل مهمة تخلص تشغّل اللي بعدها).
import type { Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { mutate, findPost, listProjects, loadProject, uid, now } from './store.js';
import { BLOB, readJSON, writeJSON, listKeys } from './storage.js';
import { flushUsage } from './usage.js';
import { internalToken } from './auth.js';

export type Emit = (ev: Record<string, any>) => void;
export type Runner = (pid: string, postId: string, params: any, emit: Emit) => Promise<any>;
export interface Job {
  id: string; pid: string; postId: string; kind: string; label: string; params: any; origin?: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  events: any[]; result?: any; error?: string; createdAt: string; startedAt?: string; endedAt?: string; updatedAt?: string;
  cancel: boolean; subs?: Set<(ev: any) => void>;
}

const runners = new Map<string, Runner>();
/** تسجيل نوع مهمة (تصميم/تعديل/…) — لازم عشان على Vercel أي جهاز يقدر يشغّلها من بياناتها */
export const registerRunner = (kind: string, fn: Runner) => runners.set(kind, fn);

const jobs = new Map<string, Job>();          // آخر مهمة لكل منشور (بذاكرة هذا الجهاز)
const queue: Job[] = [];
let active = 0;
const MAX_PARALLEL = Math.max(1, Number(process.env.JOBS_PARALLEL || 2));
const STALE_MS = (Number(process.env.JOB_MAX_SECONDS || 300) + 90) * 1000;
const key = (pid: string, postId: string) => `${pid}:${postId}`;
const jkey = (pid: string, postId: string) => `jobs/${pid}/${postId}.json`;

export class CancelledError extends Error { constructor() { super('أُلغيت المهمة'); } }

export const isBusy = (j?: Job | null) => !!j && (j.status === 'queued' || j.status === 'running');
export const summary = (j?: Job | null) => j ? ({ id: j.id, kind: j.kind, label: j.label, status: j.status, error: j.error,
  createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, position: j.status === 'queued' && !BLOB ? queue.indexOf(j) + 1 : 0 }) : null;

const plain = (j: Job) => { const { subs, ...rest } = j; return rest; };

/** آخر مهمة للمنشور: من ذاكرة هذا الجهاز، أو (Vercel) من التخزين */
export async function getJob(pid: string, postId: string): Promise<Job | null> {
  const m = jobs.get(key(pid, postId));
  if (m && (!BLOB || isBusy(m))) return m;
  if (!BLOB) return null;
  const j = await readJSON<Job>(jkey(pid, postId));
  if (j && isBusy(j) && Date.now() - +new Date(j.updatedAt || j.createdAt) > STALE_MS) {   // جهاز انتهت مدته بدون ما يكمل
    j.status = 'error'; j.error = 'انقطعت المهمة (تجاوزت مدة التشغيل) — أعد المحاولة'; j.endedAt = now();
    j.events.push({ type: 'error', message: j.error });
    await writeJSON(jkey(pid, postId), j); await setState(j, null);
  }
  return j;
}

/* ── حفظ التقدم (Vercel): مجمّع كل ثانية ونص + فحص طلب الإلغاء ── */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let lastCancelCheck = new Map<string, number>();
async function saveNow(j: Job) {
  if (!BLOB) return;
  const t = saveTimers.get(j.id); if (t) { clearTimeout(t); saveTimers.delete(j.id); }
  if (j.status === 'running' && Date.now() - (lastCancelCheck.get(j.id) || 0) > 5000) {
    lastCancelCheck.set(j.id, Date.now());
    const stored = await readJSON<Job>(jkey(j.pid, j.postId)).catch(() => null);
    if (stored?.cancel && stored.id === j.id) j.cancel = true;
  }
  j.updatedAt = now();
  await writeJSON(jkey(j.pid, j.postId), plain(j));
}
function saveSoon(j: Job) {
  if (!BLOB || saveTimers.has(j.id)) return;
  saveTimers.set(j.id, setTimeout(() => { saveTimers.delete(j.id); saveNow(j).catch(() => {}); }, 1500));
}

function push(j: Job, ev: any) {
  if (ev.type === 'progress') {   // نحتفظ بآخر تقدم فقط (ما نكبر الحجم)
    const last = j.events[j.events.length - 1];
    if (last?.type === 'progress' && last.variant === ev.variant) j.events[j.events.length - 1] = ev; else j.events.push(ev);
  } else j.events.push(ev);
  for (const s of j.subs || []) s(ev);
  saveSoon(j);
}

async function setState(j: Pick<Job, 'pid' | 'postId'>, state: 'queued' | 'designing' | null) {
  await mutate(j.pid, p => {
    const post = findPost(p, j.postId);
    post.state = state ?? (post.versions.some(v => v.verdict === 'approved' && v.id === post.current) ? 'approved' : post.versions.length ? 'review' : 'new');
  }).catch(() => {});
}

/** يبدأ مهمة. محلياً بالطابور؛ على Vercel تشتغل فوراً بنفس الاستدعاء (أو تنتظر دورها لو batch) */
export async function startJob(pid: string, postId: string, kind: string, label: string, params: any = {}, opts: { origin?: string; queued?: boolean } = {}): Promise<Job> {
  const old = await getJob(pid, postId);
  if (isBusy(old)) return old!;
  const j: Job = { id: uid(), pid, postId, kind, label, params, origin: opts.origin, status: 'queued', events: [], createdAt: now(), cancel: false, subs: new Set() };
  jobs.set(key(pid, postId), j);
  push(j, { type: 'queued', position: 1, at: Date.now() });
  await setState(j, 'queued');
  if (!BLOB) { queue.push(j); pump(); return j; }
  await saveNow(j);
  if (!opts.queued) waitUntil(run(j));
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
  const fn = runners.get(j.kind);
  j.status = 'running'; j.startedAt = now();
  await setState(j, 'designing');
  push(j, { type: 'started', label: j.label });
  await saveNow(j).catch(() => {});
  const emit: Emit = ev => { if (j.cancel) throw new CancelledError(); push(j, { ...ev, at: Date.now() }); };
  try {
    if (!fn) throw new Error(`نوع مهمة غير معروف: ${j.kind}`);
    j.result = await fn(j.pid, j.postId, j.params, emit);
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
    await saveNow(j).catch(() => {});
    await flushUsage().catch(() => {});
    for (const s of j.subs || []) s({ type: '__end' });
    j.subs?.clear();
    if (BLOB) await kick(j.pid, j.origin).catch(() => {});   // الطابور الجماعي: شغّل اللي بعدها
    else setTimeout(() => { if (jobs.get(key(j.pid, j.postId)) === j) jobs.delete(key(j.pid, j.postId)); }, 30 * 60e3).unref?.();
  }
}

/* ── الطابور الجماعي على Vercel: مهام «queued» بالتخزين، وكل ما تفضى خانة نشغّل اللي بعدها باستدعاء جديد ── */
export async function projectJobsStored(pid: string): Promise<Job[]> {
  const keys = (await listKeys(`jobs/${pid}/`)).filter(k => k.endsWith('.json'));
  return (await Promise.all(keys.map(k => readJSON<Job>(k)))).filter(Boolean) as Job[];
}
export async function kick(pid: string, origin?: string) {
  if (!BLOB || !origin) return;
  const all = await projectJobsStored(pid);
  const running = all.filter(j => j.status === 'running' && Date.now() - +new Date(j.updatedAt || j.createdAt) < STALE_MS).length;
  const waiting = all.filter(j => j.status === 'queued' && !j.cancel).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const j of waiting.slice(0, Math.max(0, MAX_PARALLEL - running))) {
    await fetch(`${origin}/api/internal/jobs/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': internalToken(),
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
      body: JSON.stringify({ pid, postId: j.postId, id: j.id }) }).catch(e => console.error('[kick]', e.message));
  }
}
/** نقطة التشغيل الداخلية (Vercel): تشغّل مهمة محفوظة بحالة queued */
export async function runStored(pid: string, postId: string, id: string) {
  await loadProject(pid);
  const j = await readJSON<Job>(jkey(pid, postId));
  if (!j || j.id !== id || j.status !== 'queued' || j.cancel) return false;
  j.subs = new Set(); jobs.set(key(pid, postId), j);
  j.status = 'running'; await saveNow(j);   // نحجزها قبل أي جهاز ثاني
  waitUntil(run(j));
  return true;
}

export async function cancelJob(pid: string, postId: string) {
  const j = jobs.get(key(pid, postId)) || (BLOB ? await readJSON<Job>(jkey(pid, postId)) : null);
  if (!j || !isBusy(j)) return false;
  j.cancel = true;
  if (j.status === 'queued') {
    if (!BLOB) queue.splice(queue.indexOf(j), 1);
    j.status = 'cancelled'; j.endedAt = now();
    j.events.push({ type: 'error', message: 'أُلغيت المهمة' });
    for (const s of j.subs || []) s({ type: '__end' }); j.subs?.clear();
    await setState(j, null);
  }
  if (BLOB) await writeJSON(jkey(pid, postId), plain(j));
  return true;
}

/** أحداث المهمة كـ NDJSON. محلياً: إعادة + بث مباشر لين تخلص. Vercel: من الحدث رقم since ويقفل (المتصفح يسحب مرة ثانية). */
export function subscribe(j: Job, res: Response, since = 0) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(JSON.stringify({ type: 'job', job: summary(j), poll: BLOB }) + '\n');
  for (const ev of j.events.slice(since)) res.write(JSON.stringify(ev) + '\n');
  if (BLOB || !isBusy(j)) return res.end();
  const sub = (ev: any) => { if (ev.type === '__end') { j.subs?.delete(sub); res.end(); } else res.write(JSON.stringify(ev) + '\n'); };
  (j.subs ||= new Set()).add(sub);
  const ping = setInterval(() => res.write(JSON.stringify({ type: 'ping' }) + '\n'), 20000);
  res.on('close', () => { clearInterval(ping); j.subs?.delete(sub); });
}

export async function projectJobs(pid: string) {
  if (BLOB) return (await projectJobsStored(pid)).map(summary);
  return [...jobs.values()].filter(j => j.pid === pid).map(summary);
}

/** بعد إعادة تشغيل السيرفر المحلي: أي منشور كان «يُصمَّم» يرجع لحالته الطبيعية */
export async function resetStaleStates() {
  if (BLOB) return;   // على Vercel الأجهزة تتجدد باستمرار — نكتشف المهام المنقطعة من وقت آخر تحديث بدلاً من ذلك
  for (const row of await listProjects()) {
    const p = await loadProject(row.id).catch(() => null);
    if (!p || !p.posts.some(x => x.state === 'designing' || x.state === 'queued')) continue;
    await mutate(p.id, pp => { for (const post of pp.posts) if (post.state === 'designing' || post.state === 'queued')
      post.state = post.versions.length ? 'review' : 'new'; });
  }
}
