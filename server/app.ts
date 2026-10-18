// تطبيق Express — نفس الكود يشتغل محلياً (server/index.ts) وعلى Vercel (api/index.ts)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { cfg, ROOT, ENGINE, DATA } from './config.js';
import {
  listProjects, getProject, loadProject, createProject, deleteProject, mutate, findPost, postDir, blankPost, uid, now, currentVersion,
  loadTaste, setTaste, appendTaste, HttpError, type Photo, type Post,
} from './store.js';
import { parseCalendar, detectService, kindOf, draftSpec, SERVICE_NAMES } from './calendar.js';
import { prepareSpec, engineAssets, fontCSS, brand, presets, fontStatus, refreshFonts, fontFiles } from './engine.js';
import { probe, cutoutAvailable, checkCutout } from './photos.js';
import { exportFull, zipDir } from './render.js';
import { lintSpec } from './lint.js';
import { designPost, revisePost, variantsPost, polishCaption, manualVersion, autoAssetsPost, editAssetPost } from './ai/designer.js';
import { startJob, getJob, isBusy, summary, subscribe, cancelJob, projectJobs, kick, runStored, registerRunner } from './jobs.js';
import { listModels, resolveTier } from './ai/router.js';
import { generate as generateImage, assetModel, testImageProvider } from './ai/images.js';
import { summary as usageSummary, live as usageLive, pricesChanged, priceOf, flushUsage } from './usage.js';
import { getSettings, loadSettings, saveSettings, publicSettings } from './settings.js';
import { BLOB, IS_VERCEL, absOf, keyOf, fileUrl, persist, removePrefix, signedUrl, ensureLocal, mimeOf } from './storage.js';
import { internalToken } from './auth.js';

/* ── أنواع المهام (لازم مسجّلة عشان على Vercel أي جهاز يقدر يشغّلها من بياناتها المحفوظة) ── */
registerRunner('design', (pid, postId, p, e) => designPost(pid, postId, e, { direction: p.direction }));
registerRunner('revise', (pid, postId, p, e) => revisePost(pid, postId, p.feedback, e, p.versionId));
registerRunner('variants', (pid, postId, p, e) => variantsPost(pid, postId, Number(p.count) || 2, e));
registerRunner('caption', (pid, postId, _p, e) => polishCaption(pid, postId, e));
registerRunner('manual', (pid, postId, p, e) => manualVersion(pid, postId, p.spec, e, p.label));
registerRunner('assets', (pid, postId, p, e) => autoAssetsPost(pid, postId, e, p));
registerRunner('asset_edit', (pid, postId, p, e) => editAssetPost(pid, postId, p.photoId, p.instruction, e, p.apply !== false));

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

/* ── الدخول (APP_PASSWORD — إلزامي على Vercel) ── */
const sessionToken = () => crypto.createHmac('sha256', cfg.sessionSecret).update(cfg.appPassword).digest('hex');
function authed(req: Request) {
  if (!cfg.appPassword) return !IS_VERCEL;   // على الإنترنت بدون كلمة مرور = مقفل
  if (req.get('x-internal-token') === internalToken()) return true;
  const c = req.cookies?.ig_session || '';
  const t = sessionToken();
  return c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}
app.post('/api/login', (req, res) => {
  if (!cfg.appPassword) return IS_VERCEL ? res.status(500).json({ error: 'ضع APP_PASSWORD بمتغيرات البيئة على Vercel' }) : res.json({ ok: true });
  const p = String(req.body?.password || '');
  const ok = p.length === cfg.appPassword.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(cfg.appPassword));
  if (!ok) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  res.cookie('ig_session', sessionToken(), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, secure: req.secure || IS_VERCEL });
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('ig_session'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: authed(req), auth: !!cfg.appPassword || IS_VERCEL }));
app.use(['/api', '/files'], (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'سجّل الدخول' })));

const wrap = (fn: (req: Request, res: Response) => any) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
const P = (req: Request) => String(req.params.pid);
const Q = (req: Request) => String(req.params.postId);
const originOf = (req: Request) => `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;

/* ── أول كل طلب: الإعدادات وسجل الذوق والخطوط (كاش قصير)، والمشروع المطلوب بأحدث نسخة ── */
app.use('/api', (_req, _res, next) => { Promise.all([loadSettings(), loadTaste(), refreshFonts()]).then(() => next(), next); });
app.param('pid', (req, _res, next, pid) => { loadProject(String(pid)).then(() => next(), next); });

/* ── المحرك والملفات ── */
if (cfg.fontsDir) app.use('/engine/assets/fonts', express.static(cfg.fontsDir, { maxAge: '7d' }));
app.use('/engine/assets', express.static(path.join(ENGINE, 'assets'), { maxAge: '7d' }));
app.get('/engine/slide.html', (_req, res) => res.sendFile(path.join(ENGINE, 'slide.html')));
/** /files/<key>: محلياً من القرص، وعلى Vercel تحويل لرابط موقّع مؤقت من Blob الخاص */
app.get('/files/{*rest}', wrap(async (req, res) => {
  const parts = ([] as string[]).concat((req.params as any).rest || []).map(decodeURIComponent);
  let key = parts.join('/');
  if (!/^(projects|_fonts)\//.test(key)) key = 'projects/' + key;   // روابط قديمة (قبل التخزين الموحّد)
  if (key.includes('..') || /\/(project\.json|_queue)/.test(key)) throw new HttpError(400, 'مسار غير صالح');
  if (BLOB) { res.setHeader('Cache-Control', 'private, max-age=300'); return res.redirect(302, await signedUrl(key)); }
  const abs = absOf(key);
  if (!abs.startsWith(DATA) || !fs.existsSync(abs)) throw new HttpError(404, 'غير موجود');
  res.setHeader('Content-Type', mimeOf(key)); res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(abs);
}));

app.get('/api/health', wrap(async (_req, res) => {
  const s = getSettings(); if (!BLOB) await Promise.race([checkCutout(), new Promise(r => setTimeout(r, 1500))]);
  res.json({
    provider: s.provider, aiReady: s.provider === 'anthropic' ? !!s.anthropicKey : !!s.radoxKey,
    cutout: cutoutAvailable(), fonts: fontStatus(), exportScale: cfg.exportScale,
    mode: BLOB ? 'vercel' : 'local', storageReady: !IS_VERCEL || BLOB, keysFromEnv: IS_VERCEL,
  });
}));

app.get('/api/engine/boot', (_req, res) => {
  const pr = presets();
  res.json({
    assets: engineAssets(), fontCSS: fontCSS(), brand: brand(),
    presets: Object.entries<any>(pr).filter(([k]) => !k.startsWith('_')).map(([k, v]) => ({ id: k, doc: v._doc || '' })),
    services: SERVICE_NAMES,
  });
});

/* ── المشاريع (تقويم = مشروع) ── */
const upMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const fixName = (n: string) => { try { return Buffer.from(n, 'latin1').toString('utf8'); } catch { return n; } };

app.get('/api/projects', wrap(async (_req, res) => res.json(await listProjects())));
app.post('/api/projects', upMem.single('file'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (req.file) {
    const posts = await parseCalendar(req.file.buffer);
    return res.json(await createProject(name || fixName(req.file.originalname).replace(/\.xlsx?$/i, ''), posts, fixName(req.file.originalname)));
  }
  res.json(await createProject(name || 'مشروع جديد', []));
}));
app.get('/api/projects/:pid', (req, res) => res.json(getProject(P(req))));
app.patch('/api/projects/:pid', wrap(async (req, res) => res.json(await mutate(P(req), p => { if (req.body.name) p.name = String(req.body.name); return p; }))));
app.delete('/api/projects/:pid', wrap(async (req, res) => { await deleteProject(P(req)); res.json({ ok: true }); }));

/* ── المنشورات ── */
const EDITABLE: (keyof Post)[] = ['title', 'ctype', 'platform', 'pillar', 'design', 'caption', 'notes', 'due', 'publish', 'status', 'theme', 'kind', 'state', 'service'];
const pick = (b: any) => Object.fromEntries(EDITABLE.filter(k => b[k] !== undefined).map(k => [k, String(b[k])]));
app.post('/api/projects/:pid/posts', wrap(async (req, res) => {
  const b = req.body || {};
  res.json(await mutate(P(req), p => {
    const d = detectService(b.title || '', b.design || '', b.caption || '');
    const post = blankPost(Math.max(0, ...p.posts.map(x => x.n)) + 1, { ...d, kind: kindOf(b.ctype || ''), ...pick(b) });
    p.posts.push(post); return post;
  }));
}));
app.patch('/api/projects/:pid/posts/:postId', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => {
    const post = findPost(p, Q(req)); Object.assign(post, pick(req.body));
    if (req.body.theme && !req.body.service) post.service = SERVICE_NAMES[post.theme] || post.service;
    post.updatedAt = now(); return post;
  }));
}));
app.delete('/api/projects/:pid/posts/:postId', wrap(async (req, res) => {
  await mutate(P(req), p => { p.posts = p.posts.filter(x => x.id !== Q(req)); });
  await removePrefix(keyOf(postDir(P(req), Q(req))) + '/');
  res.json({ ok: true });
}));
app.get('/api/projects/:pid/posts/:postId/draft', (req, res) => res.json(draftSpec(findPost(getProject(P(req)), Q(req)))));

/* ── الصور ── */
const IMG_EXT = /\.(png|jpe?g|webp|avif|heic|heif|tiff?)$/i;
async function addPhotoFile(pid: string, postId: string, abs: string, name: string, bytes: number): Promise<Photo | null> {
  try {
    const info = await probe(abs);
    await persist(abs);
    return { id: path.parse(abs).name, name, file: path.basename(abs), ...info, bytes, uploadedAt: now() };
  } catch { fs.rmSync(abs, { force: true }); return null; }
}
async function photosDone(req: Request, res: Response, added: Photo[]) {
  const post = await mutate(P(req), p => { const post = findPost(p, Q(req)); post.photos.push(...added); return post; });
  const small = added.filter(a => Math.max(a.w, a.h) < 1600).map(a => a.name);
  res.json({ post, warnings: small.length ? [`صور صغيرة الدقة (أقل من 1600px) — اطلب الأصل للجودة العالية: ${small.join('، ')}`] : [] });
}
// محلياً: رفع عادي (multipart)
const upPhotos = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => { const d = path.join(postDir(P(req), Q(req)), 'photos'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (_req, f, cb) => cb(null, uid(8) + (path.extname(fixName(f.originalname)).toLowerCase() || '.jpg')),
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 30 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//i.test(f.mimetype) || IMG_EXT.test(fixName(f.originalname))),
});
app.post('/api/projects/:pid/posts/:postId/photos', (req, _res, next) => { findPost(getProject(P(req)), Q(req)); next(); }, upPhotos.array('photos', 30), wrap(async (req, res) => {
  const added: Photo[] = [];
  for (const f of (req.files as Express.Multer.File[]) || []) { const ph = await addPhotoFile(P(req), Q(req), f.path, fixName(f.originalname), f.size); if (ph) added.push(ph); }
  await photosDone(req, res, added);
}));
// على Vercel: المتصفح يرفع مباشرة لـ Blob (بدون حد 4.5MB) ثم يسجّلها هنا
app.post('/api/blob/upload', wrap(async (req, res) => {
  const { handleUpload } = await import('@vercel/blob/client');
  const out = await handleUpload({
    body: req.body, request: req as any,
    onBeforeGenerateToken: async (pathname) => {
      if (!/^uploads\/[A-Za-z0-9]{6,40}\.(png|jpe?g|webp|avif|heic|heif|tiff?|ttf|otf)$/i.test(pathname)) throw new Error('مسار رفع غير صالح');
      return { allowedContentTypes: ['image/*', 'font/*', 'application/octet-stream', 'application/x-font-ttf', 'application/x-font-otf'], maximumSizeInBytes: 60 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true };
    },
    onUploadCompleted: async () => {},
  });
  res.json(out);
}));
app.post('/api/projects/:pid/posts/:postId/photos/register', wrap(async (req, res) => {
  findPost(getProject(P(req)), Q(req));
  const items: { pathname: string; name: string }[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const added: Photo[] = [];
  for (const it of items.slice(0, 30)) {
    if (!/^uploads\/[A-Za-z0-9]{6,40}\.\w+$/.test(String(it.pathname))) continue;
    const tmp = await ensureLocal(String(it.pathname)); if (!tmp) continue;
    const dest = path.join(postDir(P(req), Q(req)), 'photos', uid(8) + path.extname(tmp).toLowerCase());
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(tmp, dest);
    const ph = await addPhotoFile(P(req), Q(req), dest, String(it.name || path.basename(dest)), fs.statSync(dest).size);
    if (ph) added.push(ph);
    await removePrefix(String(it.pathname)).catch(() => {});
  }
  await photosDone(req, res, added);
}));
app.patch('/api/projects/:pid/posts/:postId/photos/:photoId', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => { const ph = findPost(p, Q(req)).photos.find(x => x.id === req.params.photoId); if (ph) ph.note = String(req.body.note || ''); return ph; }));
}));
app.delete('/api/projects/:pid/posts/:postId/photos/:photoId', wrap(async (req, res) => {
  let gone = '';
  const post = await mutate(P(req), p => {
    const post = findPost(p, Q(req)); const ph = post.photos.find(x => x.id === req.params.photoId);
    if (ph) gone = keyOf(path.join(postDir(p.id, post.id), 'photos', ph.file));
    post.photos = post.photos.filter(x => x.id !== req.params.photoId); return post;
  });
  if (gone) await removePrefix(gone).catch(() => {});
  res.json(post);
}));

/* ── الخطوط التجارية (Expo/Bahij) — ترتفع مرة وحدة للتخزين ── */
app.post('/api/fonts', upMem.array('fonts', 30), wrap(async (req, res) => {
  const allowed = new Set(fontFiles()); const saved: string[] = [];
  for (const f of (req.files as Express.Multer.File[]) || []) {
    const name = fixName(f.originalname);
    if (!allowed.has(name)) continue;
    const abs = absOf(`_fonts/${name}`); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.buffer);
    await persist(abs); saved.push(name);
  }
  await refreshFonts(0);
  res.json({ saved, fonts: fontStatus(), expected: [...allowed] });
}));

/* ── توليد عناصر وصور (طلب طويل) ── */
app.post('/api/projects/:pid/posts/:postId/generate', wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.description || b.prompt || '').trim()) throw new HttpError(400, 'اكتب وصف العنصر أو الصورة');
  req.setTimeout?.(10 * 60e3);
  const r = await generateImage(P(req), Q(req), { description: String(b.description || ''), kind: ['element', 'photo', 'background'].includes(b.kind) ? b.kind : 'element',
    aspect: b.aspect, quality: b.quality, n: b.n, refs: Array.isArray(b.refs) ? b.refs.map(String) : [], prompt: b.prompt });
  await flushUsage();
  res.json({ ...r, post: findPost(getProject(P(req)), Q(req)) });
}));

/* ── تجهيز للمعاينة الحية (المتصفح يرسم بنفس المحرك) ── */
app.post('/api/projects/:pid/posts/:postId/prepare', wrap(async (req, res) => {
  const post = findPost(getProject(P(req)), Q(req));
  const spec = req.body?.spec;
  if (!spec) throw new HttpError(400, 'spec مطلوب');
  const out = await prepareSpec(P(req), post, spec);
  res.json({ ...out, lint: lintSpec(spec) });
}));

/* ── الذكاء الاصطناعي: مهام بالخلفية (محلياً بث مباشر، على Vercel سحب) ── */
async function jobRoute(req: Request, res: Response, kind: string, label: string, params: any) {
  findPost(getProject(P(req)), Q(req));
  const cur = await getJob(P(req), Q(req));
  if (isBusy(cur)) return res.status(409).json({ error: 'فيه عملية شغالة على هذا المنشور — تقدر تتابعها', job: summary(cur) });
  subscribe(await startJob(P(req), Q(req), kind, label, params, { origin: originOf(req) }), res);
}
app.post('/api/projects/:pid/posts/:postId/design', wrap((req, res) => jobRoute(req, res, 'design', 'تصميم', { direction: req.body?.direction })));
app.post('/api/projects/:pid/posts/:postId/revise', wrap(async (req, res) => {
  const fb = String(req.body?.feedback || '').trim();
  if (!fb) throw new HttpError(400, 'اكتب الملاحظة');
  await jobRoute(req, res, 'revise', 'تعديل', { feedback: fb, versionId: req.body?.versionId });
}));
app.post('/api/projects/:pid/posts/:postId/variants', wrap((req, res) => jobRoute(req, res, 'variants', 'خيارات بديلة', { count: req.body?.count })));
app.post('/api/projects/:pid/posts/:postId/caption', wrap((req, res) => jobRoute(req, res, 'caption', 'تدقيق الكابشن', {})));
app.post('/api/projects/:pid/posts/:postId/manual', wrap((req, res) => jobRoute(req, res, 'manual', 'تعديل يدوي', { spec: req.body?.spec, label: req.body?.label })));
app.post('/api/projects/:pid/posts/:postId/assets/auto', wrap((req, res) => jobRoute(req, res, 'assets', 'أصول GPT Image', {
  target: req.body?.target, note: req.body?.note, versionId: req.body?.versionId, slides: Array.isArray(req.body?.slides) ? req.body.slides.map(Number) : undefined })));
app.post('/api/projects/:pid/posts/:postId/photos/:photoId/edit', wrap(async (req, res) => {
  const ins = String(req.body?.instruction || '').trim();
  if (!ins) throw new HttpError(400, 'اكتب التعديل المطلوب');
  await jobRoute(req, res, 'asset_edit', 'تعديل أصل', { photoId: String(req.params.photoId), instruction: ins, apply: req.body?.apply !== false });
}));

/* ── متابعة المهمة بعد الرجوع للصفحة ── */
app.get('/api/projects/:pid/posts/:postId/job', wrap(async (req, res) => res.json({ job: summary(await getJob(P(req), Q(req))), poll: BLOB })));
app.get('/api/projects/:pid/posts/:postId/job/stream', wrap(async (req, res) => {
  const j = await getJob(P(req), Q(req));
  if (!j) throw new HttpError(404, 'ما فيه مهمة');
  subscribe(j, res, Math.max(0, Number(req.query.since) || 0));
}));
app.post('/api/projects/:pid/posts/:postId/job/cancel', wrap(async (req, res) => res.json({ ok: await cancelJob(P(req), Q(req)) })));
// تشغيل داخلي لمهمة من الطابور (Vercel) — بالمفتاح الداخلي فقط
app.post('/api/internal/jobs/run', wrap(async (req, res) => {
  if (req.get('x-internal-token') !== internalToken()) throw new HttpError(403, 'ممنوع');
  res.json({ ok: await runStored(String(req.body?.pid), String(req.body?.postId), String(req.body?.id)) });
}));

/* ── تصميم جماعي بطابور على السيرفر (يكمل حتى لو قفلت الصفحة) ── */
app.post('/api/projects/:pid/batch', wrap(async (req, res) => {
  const p = getProject(P(req));
  const ids: string[] = Array.isArray(req.body?.postIds) ? req.body.postIds.map(String) : [];
  let n = 0;
  for (const id of ids) {
    if (!p.posts.some(x => x.id === id) || isBusy(await getJob(p.id, id))) continue;
    await startJob(p.id, id, 'design', 'تصميم (جماعي)', {}, { origin: originOf(req), queued: BLOB }); n++;
  }
  if (BLOB) await kick(p.id, originOf(req));
  res.json({ queued: n, jobs: await projectJobs(p.id) });
}));
app.get('/api/projects/:pid/jobs', wrap(async (req, res) => res.json(await projectJobs(P(req)))));
app.post('/api/projects/:pid/batch/cancel', wrap(async (req, res) => {
  const p = getProject(P(req)); let n = 0;
  for (const x of p.posts) { const j = await getJob(p.id, x.id); if (j?.status === 'queued' && await cancelJob(p.id, x.id)) n++; }
  res.json({ cancelled: n });
}));

/* ── النسخ ── */
app.post('/api/projects/:pid/posts/:postId/versions/:vid/current', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => { const post = findPost(p, Q(req)); if (post.versions.some(v => v.id === req.params.vid)) post.current = String(req.params.vid); return post; }));
}));
app.post('/api/projects/:pid/posts/:postId/versions/:vid/verdict', wrap(async (req, res) => {
  const { verdict, note, toTaste } = req.body || {};
  const post = await mutate(P(req), p => {
    const post = findPost(p, Q(req)); const v = post.versions.find(x => x.id === req.params.vid);
    if (!v) throw new HttpError(404, 'النسخة غير موجودة');
    v.verdict = verdict === 'approved' || verdict === 'rejected' ? verdict : null;
    if (note) v.feedback = String(note);
    if (verdict === 'approved') { post.current = v.id; post.state = 'approved'; }
    return post;
  });
  if (toTaste && note && (verdict === 'approved' || verdict === 'rejected')) await appendTaste(verdict, String(note), `#${post.n} ${post.title}`);
  res.json(post);
}));
app.patch('/api/projects/:pid/posts/:postId/versions/:vid', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => {
    const post = findPost(p, Q(req)); const v = post.versions.find(x => x.id === req.params.vid);
    if (!v) throw new HttpError(404, 'النسخة غير موجودة');
    if (typeof req.body?.caption === 'string') v.spec.caption = req.body.caption;
    if (Array.isArray(req.body?.hashtags)) v.spec.hashtags = req.body.hashtags.map(String);
    if (typeof req.body?.label === 'string') v.label = req.body.label;
    return post;
  }));
}));
app.delete('/api/projects/:pid/posts/:postId/versions/:vid', wrap(async (req, res) => {
  const post = await mutate(P(req), p => {
    const post = findPost(p, Q(req)); post.versions = post.versions.filter(v => v.id !== req.params.vid);
    if (post.current === req.params.vid) post.current = post.versions[post.versions.length - 1]?.id;
    return post;
  });
  await removePrefix(keyOf(path.join(postDir(P(req), Q(req)), 'renders', String(req.params.vid))) + '/').catch(() => {});
  res.json(post);
}));

/* ── الإخراج النهائي 3× ── */
app.post('/api/projects/:pid/posts/:postId/export', wrap(async (req, res) => {
  const pid = P(req), postId = Q(req);
  const post = findPost(getProject(pid), postId);
  const v = post.versions.find(x => x.id === req.body?.versionId) || currentVersion(post);
  if (!v) throw new HttpError(400, 'ما فيه نسخة للتصدير');
  const { spec } = await prepareSpec(pid, post, v.spec);
  const eid = uid(); const dir = path.join(postDir(pid, postId), 'exports', eid);
  const r = await exportFull(spec, dir, { caption: v.spec.caption ?? post.caption, hashtags: v.spec.hashtags, rawSpec: v.spec });
  const info = { id: eid, version: v.id, at: now(), files: r.files, score: r.score, dir: eid };
  await mutate(pid, p => { findPost(p, postId).exports.unshift(info); });
  res.json({ ...info, errors: r.errors, warnings: r.warnings, urls: r.files.map(f => fileUrl(path.join(dir, f))) });
}));
app.get('/api/projects/:pid/posts/:postId/exports/:eid/zip', wrap(async (req, res) => {
  const post = findPost(getProject(P(req)), Q(req));
  const ex = post.exports.find(e => e.id === req.params.eid);
  if (!ex) throw new HttpError(404, 'غير موجود');
  const dir = path.join(postDir(P(req), Q(req)), 'exports', ex.dir);
  if (BLOB && ex.files.includes('post.zip')) return res.redirect(302, await signedUrl(keyOf(path.join(dir, 'post.zip'))));
  const name = `${String(post.n).padStart(2, '0')}_${post.title.replace(/[^\w؀-ۿ]+/g, '_').slice(0, 40)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="post.zip"; filename*=UTF-8''${encodeURIComponent(name)}`);
  await zipDir(dir, ex.files.filter(f => f !== 'post.zip'), res);
}));

/* ── الإعدادات والموديلات والتكلفة وسجل الذوق ── */
app.get('/api/settings', (_req, res) => res.json({ ...publicSettings(), keysFromEnv: IS_VERCEL }));
app.put('/api/settings', wrap(async (req, res) => {
  const b = req.body || {}; const allowed: any = {};
  for (const k of ['provider', 'radoxKey', 'radoxBaseUrl', 'anthropicKey', 'models', 'routing', 'reviewRounds', 'autoFix', 'monthlyBudget', 'prices', 'imageModel', 'imageQuality', 'assetModel']) if (b[k] !== undefined) allowed[k] = b[k];
  await saveSettings(allowed);
  if (allowed.prices) pricesChanged();
  res.json({ ...publicSettings(), keysFromEnv: IS_VERCEL });
}));
app.get('/api/models', wrap(async (req, res) => {
  const { list, error } = await listModels(req.query.refresh === '1');
  const tiers: any = {};
  for (const t of ['pro', 'balanced', 'fast', 'vision'] as const) tiers[t] = await resolveTier(t).catch(() => '');
  tiers.asset = await assetModel().catch(() => '');
  res.json({ list, error, tiers });
}));
app.get('/api/usage', wrap(async (req, res) => res.json(await usageSummary({ project: req.query.project ? String(req.query.project) : undefined, post: req.query.post ? String(req.query.post) : undefined }))));
app.post('/api/images/test', wrap(async (_req, res) => { const r = await testImageProvider(); await flushUsage(); res.json(r); }));
app.get('/api/usage/live', wrap(async (req, res) => usageLive(res, req.get('last-event-id') || undefined)));
app.get('/api/prices', wrap(async (_req, res) => {
  const { list } = await listModels();
  const s = getSettings();
  const ids = [...new Set([...list.map(m => m.id), ...Object.keys(s.prices || {}), s.imageModel])];
  res.json(ids.map(id => ({ id, ...(s.prices?.[id] || {}), effective: priceOf(id) })));
}));
app.get('/api/taste', wrap(async (_req, res) => res.json({ md: await loadTaste(0) })));
app.put('/api/taste', wrap(async (req, res) => { await setTaste(String(req.body?.md || '')); res.json({ ok: true }); }));

/* ── الواجهة (بعد build) — محلياً فقط؛ Vercel يخدمها من الـ CDN ── */
const WEB = path.join(ROOT, 'web', 'dist');
if (!IS_VERCEL && fs.existsSync(WEB)) {
  app.use(express.static(WEB, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(WEB, 'index.html')) : next()));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err?.status || 500;
  if (status >= 500) console.error(err);
  if (!res.headersSent) res.status(status).json({ error: err?.message || 'خطأ غير متوقع' });
});

export default app;
