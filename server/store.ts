// تخزين بسيط على القرص: data/projects/<id>/project.json + مجلد لكل منشور (photos/ renders/ exports/)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ENGINE } from './config.js';

export const uid = (n = 10) => crypto.randomBytes(16).toString('base64url').replace(/[-_]/g, '').slice(0, n);
export const now = () => new Date().toISOString();

export interface Photo {
  id: string; name: string; file: string; w: number; h: number; aspect: number; alpha: boolean; bytes: number;
  note?: string; uploadedAt: string;
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
  state: 'new' | 'designing' | 'review' | 'approved'; chat: ChatMsg[]; updatedAt: string;
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

export function listProjects(): Project[] {
  return fs.readdirSync(PROJ, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => { try { return getProject(d.name); } catch { return null; } })
    .filter((p): p is Project => !!p)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(pid: string): Project {
  if (cache.has(pid)) return cache.get(pid)!;
  const f = path.join(projectDir(pid), 'project.json');
  if (!fs.existsSync(f)) throw new HttpError(404, 'المشروع غير موجود');
  const p = JSON.parse(fs.readFileSync(f, 'utf8')) as Project;
  cache.set(pid, p);
  return p;
}

function writeProject(p: Project) {
  const dir = projectDir(p.id); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'project.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 1)); fs.renameSync(tmp, f);
  cache.set(p.id, p);
}

/** تعديل متسلسل لكل مشروع — ما يضيع تعديل لو جاء طلبين بنفس الوقت */
export function mutate<T>(pid: string, fn: (p: Project) => T | Promise<T>): Promise<T> {
  const prev = queues.get(pid) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const p = getProject(pid);
    const r = await fn(p);
    p.updatedAt = now(); writeProject(p);
    return r;
  });
  queues.set(pid, next);
  return next;
}

export function createProject(name: string, posts: Post[], source?: string): Project {
  const p: Project = { id: uid(), name, source, createdAt: now(), updatedAt: now(), posts };
  writeProject(p);
  return p;
}

export function deleteProject(pid: string) {
  const dir = projectDir(pid);
  cache.delete(pid);
  fs.rmSync(dir, { recursive: true, force: true });
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
const TASTE = path.join(DATA, 'taste-log.md');
export function getTaste(): string {
  if (!fs.existsSync(TASTE)) fs.copyFileSync(path.join(ENGINE, 'knowledge', 'taste-log.md'), TASTE);
  return fs.readFileSync(TASTE, 'utf8');
}
export function setTaste(md: string) { fs.writeFileSync(TASTE, md); }
export function appendTaste(kind: 'approved' | 'rejected', text: string, source: string) {
  const md = getTaste();
  const line = kind === 'approved'
    ? `| ${source} | ${text.replace(/\|/g, '/').replace(/\n/g, ' ')} | الموقع ${now().slice(0, 10)} |`
    : `- ${text.replace(/\n/g, ' ')} (${source} — الموقع ${now().slice(0, 10)})`;
  const marker = kind === 'approved' ? '\n## ❌ مرفوض' : '\n## ⚠';
  const i = md.indexOf(marker);
  setTaste(i < 0 ? md + '\n' + line + '\n' : md.slice(0, i).trimEnd() + '\n' + line + '\n' + md.slice(i));
}
