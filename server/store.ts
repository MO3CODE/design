// تخزين بسيط على القرص: data/projects/<id>/project.json + مجلد لكل منشور (photos/ renders/ exports/)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ENGINE } from './config.js';
import { BLOB, readJSON, writeJSON, readText, writeText, listKeys, removePrefix } from './storage.js';

export const uid = (n = 10) => crypto.randomBytes(16).toString('base64url').replace(/[-_]/g, '').slice(0, n);
export const now = () => new Date().toISOString();

export interface Photo {
  id: string; name: string; file: string; w: number; h: number; aspect: number; alpha: boolean; bytes: number;
  note?: string; uploadedAt: string; source?: 'upload' | 'gpt-image'; prompt?: string;
  /** أصل مولّد: نوعه وسجل تعديلاته (كل تعديل = صورة جديدة مربوطة بالأصل root/parent) */
  asset?: { kind: string; description?: string; rev: number; root?: string; parent?: string; slide?: number; field?: string;
    history?: { at: string; instruction: string; prompt: string }[] };
}
export interface QcSummary { score: number; errors: string[]; warnings: string[]; lint: string[] }
export interface Version {
  id: string; n: number; createdAt: string; source: 'ai' | 'manual' | 'draft' | 'variant';
  label?: string; concept?: string; notes?: string[]; spec: any;
  qc?: QcSummary; feedback?: string; verdict?: 'approved' | 'rejected' | null; preview?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}
export interface ChatMsg { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string; version?: string }
export interface ExportInfo { id: string; version: string; at: string; files: string[]; score: number; dir: string }
export interface Post {
  id: string; n: number; title: string; ctype: string; platform: string; pillar: string;
  design: string; caption: string; notes: string; due: string; publish: string; status: string; link: string;
  service: string; theme: string; kind: 'single' | 'carousel' | 'story' | 'reel' | 'profile';
  photos: Photo[]; versions: Version[]; current?: string; exports: ExportInfo[];
  state: 'new' | 'queued' | 'designing' | 'review' | 'approved'; chat: ChatMsg[]; updatedAt: string;
}
export interface Project { id: string; name: string; source?: string; createdAt: string; updatedAt: string; posts: Post[] }

const PROJ = path.join(DATA, 'projects');
fs.mkdirSync(PROJ, { recursive: true });

export const projectDir = (pid: string) => path.join(PROJ, safeId(pid));
export const postDir = (pid: string, postId: string) => path.join(projectDir(pid), 'posts', safeId(postId));
function safeId(s: string) { if (!/^[A-Za-z0-9]{4,40}$/.test(s)) throw new HttpError(400, 'معرّف غير صالح'); return s; }

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const cache = new Map<string, Project>();
const queues = new Map<string, Promise<unknown>>();
const pkey = (pid: string) => `projects/${safeId(pid)}/project.json`;
const mkey = (pid: string) => `meta/projects/${safeId(pid)}.json`;

/** ملخص المشروع (للقائمة) — ملف صغير منفصل عشان ما نقرأ كل المشاريع */
const summaryOf = (p: Project) => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, count: p.posts.length,
  done: p.posts.filter(x => x.state === 'approved').length, inReview: p.posts.filter(x => x.state === 'review').length });
export type ProjectRow = ReturnType<typeof summaryOf>;

export async function listProjects(): Promise<ProjectRow[]> {
  const keys = (await listKeys('meta/projects/')).filter(k => k.endsWith('.json'));
  const rows = await Promise.all(keys.map(k => readJSON<ProjectRow>(k)));
  if (!BLOB) {   // توافق مع بيانات قديمة بدون ملفات ملخص
    const have = new Set(rows.filter(Boolean).map(r => r!.id));
    if (fs.existsSync(PROJ)) for (const d of fs.readdirSync(PROJ, { withFileTypes: true })) {
      if (!d.isDirectory() || have.has(d.name)) continue;
      try { const p = await loadProject(d.name); rows.push(summaryOf(p)); await writeJSON(mkey(p.id), summaryOf(p)); } catch {}
    }
  }
  return rows.filter((r): r is ProjectRow => !!r).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** يقرأ المشروع من التخزين (على Vercel دايماً أحدث نسخة) ويحطه بالذاكرة */
export async function loadProject(pid: string): Promise<Project> {
  const p = await readJSON<Project>(pkey(pid));
  if (!p) { cache.delete(pid); throw new HttpError(404, 'المشروع غير موجود'); }
  cache.set(pid, p);
  return p;
}

/** متزامن: من الذاكرة (المسارات تحمّله أول الطلب عبر loadProject) */
export function getProject(pid: string): Project {
  const c = cache.get(pid);
  if (c) return c;
  if (!BLOB) {
    const f = path.join(projectDir(pid), 'project.json');
    if (fs.existsSync(f)) { const p = JSON.parse(fs.readFileSync(f, 'utf8')) as Project; cache.set(pid, p); return p; }
  }
  throw new HttpError(404, 'المشروع غير موجود');
}

async function writeProject(p: Project) {
  cache.set(p.id, p);
  await writeJSON(pkey(p.id), p);
  await writeJSON(mkey(p.id), summaryOf(p));
}

/** تعديل متسلسل لكل مشروع — يقرأ أحدث نسخة قبل التعديل (مهم على Vercel: أكثر من جهاز) */
export function mutate<T>(pid: string, fn: (p: Project) => T | Promise<T>): Promise<T> {
  const prev = queues.get(pid) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const p = BLOB ? await loadProject(pid) : getProject(pid);
    const r = await fn(p);
    p.updatedAt = now(); await writeProject(p);
    return r;
  });
  queues.set(pid, next);
  return next;
}

export async function createProject(name: string, posts: Post[], source?: string): Promise<Project> {
  const p: Project = { id: uid(), name, source, createdAt: now(), updatedAt: now(), posts };
  await writeProject(p);
  return p;
}

export async function deleteProject(pid: string) {
  cache.delete(pid);
  await removePrefix(`projects/${safeId(pid)}/`);
  await removePrefix(mkey(pid));
}

export function findPost(p: Project, postId: string): Post {
  const post = p.posts.find(x => x.id === postId);
  if (!post) throw new HttpError(404, 'المنشور غير موجود');
  return post;
}

export function currentVersion(post: Post): Version | undefined {
  return post.versions.find(v => v.id === post.current) || post.versions[post.versions.length - 1];
}

export function blankPost(n: number, fields: Partial<Post>): Post {
  return {
    id: uid(), n, title: '', ctype: '', platform: '', pillar: '', design: '', caption: '', notes: '', due: '', publish: '',
    status: '', link: '', service: 'العلامة الأم', theme: 'graphite', kind: 'single', photos: [], versions: [], exports: [],
    state: 'new', chat: [], updatedAt: now(), ...fields,
  };
}

/* ── سجل الذوق: يبدأ من نسخة المهارة ويتطور من الموقع ── */
let taste: { md: string; at: number } | null = null;
export async function loadTaste(maxAgeMs = 15000) {
  if (taste && Date.now() - taste.at < maxAgeMs) return taste.md;
  const md = (await readText('taste-log.md')) ?? fs.readFileSync(path.join(ENGINE, 'knowledge', 'taste-log.md'), 'utf8');
  taste = { md, at: Date.now() };
  return md;
}
export function getTaste(): string {
  return taste?.md ?? ((!BLOB && fs.existsSync(path.join(DATA, 'taste-log.md'))) ? fs.readFileSync(path.join(DATA, 'taste-log.md'), 'utf8')
    : fs.readFileSync(path.join(ENGINE, 'knowledge', 'taste-log.md'), 'utf8'));
}
export async function setTaste(md: string) { taste = { md, at: Date.now() }; await writeText('taste-log.md', md); }
export async function appendTaste(kind: 'approved' | 'rejected', text: string, source: string) {
  const md = await loadTaste(0);
  const one = text.replace(/\n/g, ' ');
  const line = kind === 'approved'
    ? `| ${source} | ${one.replace(/\|/g, '/')} | الموقع ${now().slice(0, 10)} |`
    : `- ${one} (${source} — الموقع ${now().slice(0, 10)})`;
  const marker = kind === 'approved' ? '\n## ❌ مرفوض' : '\n## ⚠';
  const i = md.indexOf(marker);
  await setTaste(i < 0 ? `${md}\n${line}\n` : `${md.slice(0, i).trimEnd()}\n${line}\n${md.slice(i)}`);
}
