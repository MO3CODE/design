// طبقة التخزين: محلياً = مجلد data/ ، على Vercel = Blob خاص (private) + نسخة مؤقتة بـ /tmp للعمل.
// المفاتيح مسارات نسبية (posix) مثل: projects/<pid>/project.json · projects/<pid>/posts/<id>/photos/x.png
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.js';

export const IS_VERCEL = !!process.env.VERCEL;
export const BLOB = !!process.env.BLOB_READ_WRITE_TOKEN && process.env.STORAGE !== 'local';

const blobMod = () => import('@vercel/blob');
export const keyOf = (abs: string) => path.relative(DATA, abs).split(path.sep).join('/');
export const absOf = (key: string) => path.join(DATA, ...key.split('/'));
export const fileUrl = (absOrKey: string) => '/files/' + (path.isAbsolute(absOrKey) ? keyOf(absOrKey) : absOrKey).split('/').map(encodeURIComponent).join('/');

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip', '.ttf': 'font/ttf', '.otf': 'font/otf', '.jsonl': 'application/x-ndjson',
  '.avif': 'image/avif', '.heic': 'image/heic', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
export const mimeOf = (k: string) => MIME[path.extname(k).toLowerCase()] || 'application/octet-stream';

async function blobPut(key: string, body: Buffer | string, contentType = mimeOf(key)) {
  const { put } = await blobMod();
  await put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 60,
    multipart: typeof body !== 'string' && body.length > 8 * 1024 * 1024 });
}
async function blobGet(key: string): Promise<Buffer | null> {
  const { get } = await blobMod();
  const r = await get(key, { access: 'private', useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

/* ── نص/JSON (حالة المشاريع والإعدادات…) ── */
export async function readText(key: string): Promise<string | null> {
  if (!BLOB) { const f = absOf(key); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }
  const b = await blobGet(key); return b ? b.toString('utf8') : null;
}
export async function writeText(key: string, text: string) {
  const f = absOf(key); fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, f);
  if (BLOB) await blobPut(key, text, mimeOf(key));
}
export async function readJSON<T>(key: string): Promise<T | null> {
  const t = await readText(key); if (t == null) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}
export const writeJSON = (key: string, v: unknown) => writeText(key, JSON.stringify(v, null, 1));

/* ── ملفات (صور، معاينات، إخراج) ── */
/** يحفظ ملف موجود محلياً للتخزين الدائم (على Vercel يرفعه لـ Blob) */
export async function persist(absOrKey: string) {
  if (!BLOB) return;
  const abs = path.isAbsolute(absOrKey) ? absOrKey : absOf(absOrKey);
  await blobPut(keyOf(abs), fs.readFileSync(abs));
}
export async function persistMany(files: string[], parallel = 6) {
  if (!BLOB) return;
  for (let i = 0; i < files.length; i += parallel) await Promise.all(files.slice(i, i + parallel).map(f => persist(f)));
}
/** يضمن وجود الملف محلياً (على Vercel ينزّله من Blob لو مو موجود بهذا الجهاز) — يرجّع المسار المحلي أو null */
export async function ensureLocal(absOrKey: string): Promise<string | null> {
  const abs = path.isAbsolute(absOrKey) ? absOrKey : absOf(absOrKey);
  if (fs.existsSync(abs)) return abs;
  if (!BLOB) return null;
  const b = await blobGet(keyOf(abs)); if (!b) return null;
  fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, b);
  return abs;
}
export async function exists(absOrKey: string): Promise<boolean> {
  const abs = path.isAbsolute(absOrKey) ? absOrKey : absOf(absOrKey);
  if (fs.existsSync(abs)) return true;
  if (!BLOB) return false;
  const { head } = await blobMod();
  try { await head(keyOf(abs)); return true; } catch { return false; }
}
export async function listKeys(prefix: string): Promise<string[]> {
  if (!BLOB) {
    const base = absOf(prefix); if (!fs.existsSync(base)) return [];
    const out: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(keyOf(p)); } };
    walk(base); return out;
  }
  const { list } = await blobMod();
  const out: string[] = []; let cursor: string | undefined;
  do { const r = await list({ prefix, cursor, limit: 1000 }); out.push(...r.blobs.map(b => b.pathname)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out;
}
export async function removePrefix(prefix: string) {
  fs.rmSync(absOf(prefix), { recursive: true, force: true });
  if (!BLOB) return;
  const keys = await listKeys(prefix);
  const { del } = await blobMod();
  for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500));
}

/* ── روابط موقّعة مؤقتة للعرض (Blob خاص) ── */
let signed: { token: any; until: number } | null = null;
export async function signedUrl(key: string, ttlMs = 60 * 60e3): Promise<string> {
  const { issueSignedToken, presignUrl } = await blobMod();
  if (!signed || signed.until < Date.now() + ttlMs + 60e3) {
    const until = Date.now() + 6 * 60 * 60e3;
    signed = { token: await issueSignedToken({ operations: ['get'], validUntil: until }), until };
  }
  const { presignedUrl } = await presignUrl(signed.token, { operation: 'get', pathname: key, access: 'private', validUntil: Date.now() + ttlMs });
  return presignedUrl;
}
