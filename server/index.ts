// سيرفر استوديو تصاميم بوابة المستثمر
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { cfg, ROOT, ENGINE, DATA } from './config.js';
import {
  listProjects, getProject, createProject, deleteProject, mutate, findPost, postDir, blankPost, uid, now, currentVersion,
  getTaste, setTaste, appendTaste, HttpError, type Photo, type Post,
} from './store.js';
import { parseCalendar, detectService, kindOf, draftSpec, SERVICE_NAMES } from './calendar.js';
import { prepareSpec, engineAssets, fontCSS, brand, presets, fontStatus } from './engine.js';
import { probe, cutoutAvailable, checkCutout } from './photos.js';
import { exportFull, zipDir, INTERNAL_TOKEN, closeRenderer } from './render.js';
import { lintSpec } from './lint.js';
import { designPost, revisePost, variantsPost, polishCaption, manualVersion, autoAssetsPost, editAssetPost } from './ai/designer.js';
import { startJob, getJob, isBusy, summary, subscribe, cancelJob, projectJobs, resetStaleStates, type Emit } from './jobs.js';
import { listModels, resolveTier } from './ai/router.js';
import { generate as generateImage, assetModel, testImageProvider } from './ai/images.js';
import { summary as usageSummary, live as usageLive, pricesChanged, priceOf } from './usage.js';
import { getSettings, saveSettings, publicSettings } from './settings.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

/* ── الدخول (اختياري: APP_PASSWORD) ── */
const sessionToken = () => crypto.createHmac('sha256', cfg.sessionSecret).update(cfg.appPassword).digest('hex');
function authed(req: Request) {
  if (!cfg.appPassword) return true;
  if (req.get('x-internal-token') === INTERNAL_TOKEN) return true;
  const c = req.cookies?.ig_session || '';
  const t = sessionToken();
  return c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}
app.post('/api/login', (req, res) => {
  if (!cfg.appPassword) return res.json({ ok: true });
  const p = String(req.body?.password || '');
  const ok = p.length === cfg.appPassword.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(cfg.appPassword));
  if (!ok) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  res.cookie('ig_session', sessionToken(), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, secure: req.secure });
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.clearCookie('ig_session'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: authed(req), auth: !!cfg.appPassword }));
app.use(['/api', '/engine', '/files'], (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'سجّل الدخول' })));

/* ── المحرك والملفات ── */
if (cfg.fontsDir) app.use('/engine/assets/fonts', express.static(cfg.fontsDir, { maxAge: '7d' }));   // خطوط تجارية خارج الريبو
app.use('/engine/assets', express.static(path.join(ENGINE, 'assets'), { maxAge: '7d' }));
app.get('/engine/slide.html', (_req, res) => res.sendFile(path.join(ENGINE, 'slide.html')));
app.use('/files', express.static(path.join(DATA, 'projects'), { maxAge: '1h', dotfiles: 'deny' }));

const wrap = (fn: (req: Request, res: Response) => any) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);
const P = (req: Request) => String(req.params.pid);
const Q = (req: Request) => String(req.params.postId);

app.get('/api/health', wrap(async (_req, res) => {
  const s = getSettings(); await Promise.race([checkCutout(), new Promise(r => setTimeout(r, 1500))]);
  res.json({
    provider: s.provider, aiReady: s.provider === 'anthropic' ? !!s.anthropicKey : !!s.radoxKey,
    cutout: cutoutAvailable(), fonts: fontStatus(), exportScale: cfg.exportScale
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

app.get('/api/projects', (_req, res) => res.json(listProjects().map(p => ({
  id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, count: p.posts.length,
  done: p.posts.filter(x => x.state === 'approved').length, inReview: p.posts.filter(x => x.state === 'review').length,
}))));

app.post('/api/projects', upMem.single('file'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (req.file) {
    const posts = await parseCalendar(req.file.buffer);
    const p = createProject(name || fixName(req.file.originalname).replace(/\.xlsx?$/i, ''), posts, fixName(req.file.originalname));
    return res.json(p);
  }
  res.json(createProject(name || 'مشروع جديد', []));
}));

app.get('/api/projects/:pid', (req, res) => res.json(getProject(P(req))));
app.patch('/api/projects/:pid', wrap(async (req, res) => res.json(await mutate(P(req), p => { if (req.body.name) p.name = String(req.body.name); return p; }))));
app.delete('/api/projects/:pid', (req, res) => { getProject(P(req)); deleteProject(P(req)); res.json({ ok: true }); });

/* ── المنشورات ── */
const EDITABLE: (keyof Post)[] = ['title', 'ctype', 'platform', 'pillar', 'design', 'caption', 'notes', 'due', 'publish', 'status', 'theme', 'kind', 'state', 'service'];
app.post('/api/projects/:pid/posts', wrap(async (req, res) => {
  const b = req.body || {};
  const post = await mutate(P(req), p => {
    const d = detectService(b.title || '', b.design || '', b.caption || '');
    const post = blankPost(Math.max(0, ...p.posts.map(x => x.n)) + 1, { ...d, kind: kindOf(b.ctype || ''), ...pick(b) });
    p.posts.push(post); return post;
  });
  res.json(post);
}));
const pick = (b: any) => Object.fromEntries(EDITABLE.filter(k => b[k] !== undefined).map(k => [k, String(b[k])]));
app.patch('/api/projects/:pid/posts/:postId', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => {
    const post = findPost(p, Q(req)); Object.assign(post, pick(req.body));
    if (req.body.theme && !req.body.service) post.service = SERVICE_NAMES[post.theme] || post.service;
    post.updatedAt = now(); return post;
  }));
}));
app.delete('/api/projects/:pid/posts/:postId', wrap(async (req, res) => {
  await mutate(P(req), p => { p.posts = p.posts.filter(x => x.id !== Q(req)); });
  fs.rmSync(postDir(P(req), Q(req)), { recursive: true, force: true });
  res.json({ ok: true });
}));
app.get('/api/projects/:pid/posts/:postId/draft', (req, res) => res.json(draftSpec(findPost(getProject(P(req)), Q(req)))));

/* ── الصور ── */
const upPhotos = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => { const d = path.join(postDir(P(req), Q(req)), 'photos'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (_req, f, cb) => cb(null, uid(8) + (path.extname(fixName(f.originalname)).toLowerCase() || '.jpg')),
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 30 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//i.test(f.mimetype) || /\.(png|jpe?g|webp|avif|heic|heif|tiff?)$/i.test(fixName(f.originalname))),
});
app.post('/api/projects/:pid/posts/:postId/photos', (req, res, next) => { findPost(getProject(P(req)), Q(req)); next(); }, upPhotos.array('photos', 30), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const added: Photo[] = [];
  for (const f of files) {
    try {
      const info = await probe(f.path);
      added.push({ id: path.parse(f.filename).name, name: fixName(f.originalname), file: f.filename, ...info, bytes: f.size, uploadedAt: now() });
    } catch { fs.rmSync(f.path, { force: true }); }
  }
  const post = await mutate(P(req), p => { const post = findPost(p, Q(req)); post.photos.push(...added); return post; });
  const small = added.filter(a => Math.max(a.w, a.h) < 1600).map(a => a.name);
  res.json({ post, warnings: small.length ? [`صور صغيرة الدقة (أقل من 1600px) — اطلب الأصل للجودة العالية: ${small.join('، ')}`] : [] });
}));
app.patch('/api/projects/:pid/posts/:postId/photos/:photoId', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => { const ph = findPost(p, Q(req)).photos.find(x => x.id === req.params.photoId); if (ph) ph.note = String(req.body.note || ''); return ph; }));
}));
app.delete('/api/projects/:pid/posts/:postId/photos/:photoId', wrap(async (req, res) => {
  res.json(await mutate(P(req), p => {
    const post = findPost(p, Q(req)); const ph = post.photos.find(x => x.id === req.params.photoId);
    if (ph) fs.rmSync(path.join(postDir(p.id, post.id), 'photos', ph.file), { force: true });
    post.photos = post.photos.filter(x => x.id !== req.params.photoId); return post;
  }));
}));

/* ── توليد عناصر وصور بـ GPT Image (طلب طويل — لو طلعت من الصفحة الصورة تنحفظ للمنشور برضو) ── */
app.post('/api/projects/:pid/posts/:postId/generate', wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.description || b.prompt || '').trim()) throw new HttpError(400, 'اكتب وصف العنصر أو الصورة');
  req.setTimeout(10 * 60e3);
  const r = await generateImage(P(req), Q(req), { description: String(b.description || ''), kind: ['element', 'photo', 'background'].includes(b.kind) ? b.kind : 'element',
    aspect: b.aspect, quality: b.quality, n: b.n, refs: Array.isArray(b.refs) ? b.refs.map(String) : [], prompt: b.prompt });
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

/* ── الذكاء الاصطناعي (بث NDJSON بالتقدم) ── */
function jobRoute(req: Request, res: Response, kind: string, label: string, fn: (emit: Emit) => Promise<any>) {
  findPost(getProject(P(req)), Q(req));
  const cur = getJob(P(req), Q(req));
  if (isBusy(cur)) return res.status(409).json({ error: 'فيه عملية شغالة على هذا المنشور — تقدر تتابعها', job: summary(cur) });
  subscribe(startJob(P(req), Q(req), kind, label, fn), res);
}
app.post('/api/projects/:pid/posts/:postId/design', (req, res) => jobRoute(req, res, 'design', 'تصميم', e => designPost(P(req), Q(req), e, { direction: req.body?.direction })));
app.post('/api/projects/:pid/posts/:postId/revise', (req, res) => {
  const fb = String(req.body?.feedback || '').trim();
  if (!fb) return res.status(400).json({ error: 'اكتب الملاحظة' });
  jobRoute(req, res, 'revise', 'تعديل', e => revisePost(P(req), Q(req), fb, e, req.body?.versionId));
});
app.post('/api/projects/:pid/posts/:postId/variants', (req, res) => jobRoute(req, res, 'variants', 'خيارات بديلة', e => variantsPost(P(req), Q(req), Number(req.body?.count) || 2, e)));
app.post('/api/projects/:pid/posts/:postId/caption', (req, res) => jobRoute(req, res, 'caption', 'تدقيق الكابشن', e => polishCaption(P(req), Q(req), e)));
app.post('/api/projects/:pid/posts/:postId/manual', (req, res) => jobRoute(req, res, 'manual', 'تعديل يدوي', e => manualVersion(P(req), Q(req), req.body?.spec, e, req.body?.label)));

app.post('/api/projects/:pid/posts/:postId/assets/auto', (req, res) => jobRoute(req, res, 'assets', 'أصول GPT Image', e => autoAssetsPost(P(req), Q(req), e, {
  target: req.body?.target, note: req.body?.note, versionId: req.body?.versionId, slides: Array.isArray(req.body?.slides) ? req.body.slides.map(Number) : undefined })));
app.post('/api/projects/:pid/posts/:postId/photos/:photoId/edit', (req, res) => {
  const ins = String(req.body?.instruction || '').trim();
  if (!ins) return res.status(400).json({ error: 'اكتب التعديل المطلوب' });
  jobRoute(req, res, 'asset_edit', 'تعديل أصل', e => editAssetPost(P(req), Q(req), String(req.params.photoId), ins, e, req.body?.apply !== false));
});

/* ── متابعة المهمة بعد الرجوع للصفحة ── */
app.get('/api/projects/:pid/posts/:postId/job', (req, res) => res.json({ job: summary(getJob(P(req), Q(req))) || null }));
app.get('/api/projects/:pid/posts/:postId/job/stream', (req, res) => {
  const j = getJob(P(req), Q(req));
  if (!j) return res.status(404).json({ error: 'ما فيه مهمة' });
  subscribe(j, res);
});
app.post('/api/projects/:pid/posts/:postId/job/cancel', (req, res) => res.json({ ok: cancelJob(P(req), Q(req)) }));

/* ── تصميم جماعي بطابور على السيرفر (يكمل حتى لو قفلت الصفحة) ── */
app.post('/api/projects/:pid/batch', wrap(async (req, res) => {
  const p = getProject(P(req));
  const ids: string[] = Array.isArray(req.body?.postIds) ? req.body.postIds.map(String) : [];
  let n = 0;
  for (const id of ids) {
    if (!p.posts.some(x => x.id === id) || isBusy(getJob(p.id, id))) continue;
    startJob(p.id, id, 'design', 'تصميم (جماعي)', e => designPost(p.id, id, e)); n++;
  }
  res.json({ queued: n, jobs: projectJobs(p.id) });
}));
app.get('/api/projects/:pid/jobs', (req, res) => res.json(projectJobs(P(req))));
app.post('/api/projects/:pid/batch/cancel', (req, res) => {
  const p = getProject(P(req)); let n = 0;
  for (const x of p.posts) if (getJob(p.id, x.id)?.status === 'queued' && cancelJob(p.id, x.id)) n++;
  res.json({ cancelled: n });
});

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
  if (toTaste && note && (verdict === 'approved' || verdict === 'rejected')) appendTaste(verdict, String(note), `#${post.n} ${post.title}`);
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
  res.json(await mutate(P(req), p => {
    const post = findPost(p, Q(req)); post.versions = post.versions.filter(v => v.id !== req.params.vid);
    if (post.current === req.params.vid) post.current = post.versions[post.versions.length - 1]?.id;
    fs.rmSync(path.join(postDir(p.id, post.id), 'renders', String(req.params.vid)), { recursive: true, force: true });
    return post;
  }));
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
  res.json({ ...info, errors: r.errors, warnings: r.warnings,
    urls: r.files.map(f => `/files/${pid}/posts/${postId}/exports/${eid}/${encodeURIComponent(f)}`) });
}));
app.get('/api/projects/:pid/posts/:postId/exports/:eid/zip', wrap(async (req, res) => {
  const post = findPost(getProject(P(req)), Q(req));
  const ex = post.exports.find(e => e.id === req.params.eid);
  if (!ex) throw new HttpError(404, 'غير موجود');
  const dir = path.join(postDir(P(req), Q(req)), 'exports', ex.dir);
  const name = `${String(post.n).padStart(2, '0')}_${post.title.replace(/[^\w؀-ۿ]+/g, '_').slice(0, 40)}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="post.zip"; filename*=UTF-8''${encodeURIComponent(name)}`);
  await zipDir(dir, ex.files, res);
}));

/* ── الإعدادات والموديلات والتكلفة وسجل الذوق ── */
app.get('/api/settings', (_req, res) => res.json(publicSettings()));
app.put('/api/settings', wrap(async (req, res) => {
  const b = req.body || {}; const allowed: any = {};
  for (const k of ['provider', 'radoxKey', 'radoxBaseUrl', 'anthropicKey', 'models', 'routing', 'reviewRounds', 'autoFix', 'monthlyBudget', 'prices', 'imageModel', 'imageQuality', 'assetModel']) if (b[k] !== undefined) allowed[k] = b[k];
  saveSettings(allowed);
  if (allowed.prices) pricesChanged();
  res.json(publicSettings());
}));
app.get('/api/models', wrap(async (req, res) => {
  const { list, error } = await listModels(req.query.refresh === '1');
  const tiers: any = {};
  for (const t of ['pro', 'balanced', 'fast', 'vision'] as const) tiers[t] = await resolveTier(t).catch(() => '');
  tiers.asset = await assetModel().catch(() => '');
  res.json({ list, error, tiers });
}));
app.get('/api/usage', (req, res) => res.json(usageSummary({ project: req.query.project ? String(req.query.project) : undefined, post: req.query.post ? String(req.query.post) : undefined })));
app.post('/api/images/test', wrap(async (_req, res) => res.json(await testImageProvider())));
app.get('/api/usage/live', (_req, res) => usageLive(res));
app.get('/api/prices', wrap(async (_req, res) => {
  const { list } = await listModels();
  const s = getSettings();
  const ids = [...new Set([...list.map(m => m.id), ...Object.keys(s.prices || {}), s.imageModel])];
  res.json(ids.map(id => ({ id, ...(s.prices?.[id] || {}), effective: priceOf(id) })));
}));
app.get('/api/taste', (_req, res) => res.json({ md: getTaste() }));
app.put('/api/taste', (req, res) => { setTaste(String(req.body?.md || '')); res.json({ ok: true }); });

/* ── الواجهة (بعد build) ── */
const WEB = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(WEB)) {
  app.use(express.static(WEB, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(WEB, 'index.html')) : next()));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err?.status || 500;
  if (status >= 500) console.error(err);
  if (!res.headersSent) res.status(status).json({ error: err?.message || 'خطأ غير متوقع' });
});

resetStaleStates().catch(() => {});
const server = app.listen(cfg.port, () => {
  const s = getSettings();
  console.log(`\n  استوديو بوابة المستثمر  →  http://localhost:${cfg.port}`);
  console.log(`  AI: ${s.provider} ${(s.provider === 'anthropic' ? s.anthropicKey : s.radoxKey) ? '✓' : '✗ (أضف المفتاح من الإعدادات)'} · التوجيه: ${s.routing}`);
  checkCutout().then(ok => console.log(`  قص الخلفية (rembg): ${ok ? '✓' : '✗ — ارفع الأصول PNG مقصوصة'}\n`));
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await closeRenderer(); server.close(); process.exit(0); });
