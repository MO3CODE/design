// الرسم: كروم (puppeteer-core) يفتح engine/slide.html ويرسم كل شريحة عبر window.render — نفس render.js بالمهارة
// + فحص التباين (qa.py) + نسخ النشر (PNG كامل + JPG 2160 + JPG 1080 بجودة 97 بدون subsampling) + ورقة معاينة + شريط الكاروسيل.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { cfg, SIZES } from './config.js';
import { brand, engineAssets, fontCSS } from './engine.js';
import { internalToken } from './auth.js';
import { BLOB, persistMany } from './storage.js';

export const INTERNAL_TOKEN = internalToken();
/** عنوان السيرفر كما يراه كروم: محلياً localhost، وعلى Vercel دومين الإنتاج */
const selfUrl = () => process.env.SELF_URL || (process.env.VERCEL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}` : cfg.selfUrl);

async function launch(): Promise<Browser> {
  if (process.env.VERCEL) {   // كروم مخصص للسيرفرلس
    const chromium = (await import('@sparticuz/chromium')).default as any;
    return puppeteer.launch({ executablePath: await chromium.executablePath(), headless: 'shell',
      args: [...chromium.args, '--font-render-hinting=none', '--force-color-profile=srgb'] } as any);
  }
  return puppeteer.launch({ executablePath: findChrome(), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--force-color-profile=srgb'] });
}

function findChrome(): string {
  const c = [cfg.chromePath, process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  throw new Error('كروم/إيدج غير موجود — حدّد CHROME_PATH بملف .env');
}

let browserP: Promise<Browser> | null = null;
let pageP: Promise<Page> | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function getPage(): Promise<Page> {
  if (!browserP) browserP = launch().then(b => { b.on('disconnected', () => { browserP = null; pageP = null; }); return b; })
    .catch(e => { browserP = null; throw e; });
  if (!pageP) pageP = (async () => {
    const b = await browserP!;
    const page = await b.newPage();
    await page.setExtraHTTPHeaders({ 'x-internal-token': INTERNAL_TOKEN,
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) });
    page.on('pageerror', e => console.error('  [engine]', (e as Error).message));
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.goto(selfUrl() + '/engine/slide.html', { waitUntil: 'load', timeout: 60000 });
    await page.evaluate((css: string) => { document.getElementById('fontcss')!.textContent = css; }, fontCSS());
    await page.evaluate(async () => {
      for (const f of ['Bahij', 'Expo', 'ThSans', 'ThSerif', 'Plex']) for (const w of [400, 500, 700, 800, 900]) await document.fonts.load(`${w} 40px ${f}`);
      await document.fonts.load('40px tabler'); await document.fonts.ready;
    });
    return page;
  })().catch(e => { pageP = null; throw e; });
  return pageP;
}

/** كل الرسم يمر بطابور واحد (صفحة كروم وحدة) */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const r = chain.catch(() => {}).then(fn);
  chain = r;
  return r;
}

export interface SlideQC { slide: number; type?: string; errors: string[]; warnings: string[]; notes?: string[]; texts: any[]; W: number; H: number }
export interface Rendered { png: Buffer; bg?: Buffer; qc: SlideQC }

export function renderSlides(spec: any, o: { scale?: number; only?: number[]; bg?: boolean; jpeg?: boolean } = {}): Promise<Rendered[]> {
  return queued(async () => {
    const page = await getPage();
    const [W, H] = SIZES[spec.format || 'post'] || SIZES.post;
    const scale = o.scale || cfg.exportScale;
    await page.setViewport({ width: W, height: H, deviceScaleFactor: scale });
    const slides = spec.slides || [spec];
    const A = engineAssets(), B = brand();
    const out: Rendered[] = [];
    for (let i = 0; i < slides.length; i++) {
      if (o.only && !o.only.includes(i + 1)) continue;
      const D = { spec, slide: slides[i], i, n: slides.length, assets: A, brand: B };
      const qc = await page.evaluate(async (d: any) => await (window as any).render(d), D) as SlideQC;
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
        // صور الخلفيات (background-image) — ننتظرها كمان
        const urls = new Set<string>();
        document.querySelectorAll<HTMLElement>('.canvas, .canvas *').forEach(el => {
          const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/g) || [];
          m.forEach(u => urls.add(u.replace(/^url\("?|"?\)$/g, '')));
        });
        await Promise.all([...urls].map(u => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = u; })));
      });
      await new Promise(r => setTimeout(r, 120));
      const clip = { x: 0, y: 0, width: W, height: H };
      const png = Buffer.from(await page.screenshot(o.jpeg ? { clip, type: 'jpeg', quality: 88 } : { clip, type: 'png' }));
      let bg: Buffer | undefined;
      if (o.bg) {
        await page.evaluate(() => document.querySelector('.canvas')!.classList.add('bgonly'));
        bg = Buffer.from(await page.screenshot({ clip, type: 'png' }));
      }
      out.push({ png, bg, qc: { ...qc, slide: i + 1 } });
    }
    return out;
  });
}

/* ── فحص التباين (qa.py) ── */
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number, b: number) => { const [x, y] = a > b ? [a, b] : [b, a]; return (x + 0.05) / (y + 0.05); };
function rgbOf(css: string): number[] | null {
  const m = (css || '').match(/[\d.]+/g); if (!m || m.length < 3) return null;
  if (m.length >= 4 && Number(m[3]) === 0) return null;   // نص ذهبي متدرّج (شفاف) — نقيسه كذهبي
  return m.slice(0, 3).map(x => Number(x) / 255);
}

export async function contrastQA(r: Rendered) {
  if (!r.bg) return;
  const { data, info } = await sharp(r.bg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = info.width / r.qc.W;
  for (const t of r.qc.texts || []) {
    if (t.own_bg) continue;
    const col = rgbOf(t.color) || [0.89, 0.76, 0.56];
    const x0 = Math.max(0, Math.floor(t.x * k)), y0 = Math.max(0, Math.floor(t.y * k));
    const x1 = Math.min(info.width, Math.ceil((t.x + t.w) * k)), y1 = Math.min(info.height, Math.ceil((t.y + t.h) * k));
    if (x1 <= x0 || y1 <= y0) continue;
    const L: number[] = []; const step = Math.max(1, Math.round(k));   // عيّنة (كل بكسل بالدقة 1×)
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
      const i = (y * info.width + x) * 3; L.push(lum(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255));
    }
    if (!L.length) continue;
    L.sort((a, b) => a - b);
    const lc = lum(col[0], col[1], col[2]);
    const worst = L[Math.min(L.length - 1, Math.floor(L.length * (lc < 0.5 ? 0.9 : 0.1)))];
    const cr = ratio(lc, worst), need = t.fs >= 36 ? 3 : 4.5;
    if (cr < need * 0.75) r.qc.errors.push(`تباين ضعيف ${cr.toFixed(1)}:1 «${t.t}»`);
    else if (cr < need) r.qc.warnings.push(`تباين ${cr.toFixed(1)}:1 «${t.t}»`);
  }
}

export function scoreOf(qcs: SlideQC[]) {
  const errors = qcs.flatMap(q => q.errors.map(e => `#${q.slide}: ${e}`));
  const warnings = qcs.flatMap(q => q.warnings.map(w => `#${q.slide}: ${w}`));
  return { score: Math.max(0, 100 - 15 * errors.length - 3 * warnings.length), errors, warnings };
}

/** ورقة معاينة (شبكة) أو شريط متصل للكاروسيل */
export async function contactSheet(imgs: Buffer[], mode: 'grid' | 'strip', tw = 360): Promise<Buffer> {
  const m0 = await sharp(imgs[0]).metadata();
  const th = Math.round((m0.height! * tw) / m0.width!);
  const thumbs = await Promise.all(imgs.map(b => sharp(b).resize(tw, th).toBuffer()));
  if (mode === 'strip') {
    return sharp({ create: { width: tw * imgs.length, height: th, channels: 3, background: '#000' } })
      .composite(thumbs.map((b, i) => ({ input: b, left: i * tw, top: 0 }))).jpeg({ quality: 90 }).toBuffer();
  }
  const cols = Math.min(5, imgs.length), rows = Math.ceil(imgs.length / cols), g = 14;
  return sharp({ create: { width: cols * tw + (cols + 1) * g, height: rows * th + (rows + 1) * g, channels: 3, background: '#2a2723' } })
    .composite(thumbs.map((b, i) => ({ input: b, left: g + (i % cols) * (tw + g), top: g + Math.floor(i / cols) * (th + g) })))
    .jpeg({ quality: 90 }).toBuffer();
}

/** الإخراج النهائي بأعلى جودة — يكتب كل الملفات بالمجلد ويرجع القائمة + الدرجة */
export async function exportFull(spec: any, outDir: string, extra: { caption?: string; hashtags?: string[]; rawSpec?: any }) {
  fs.mkdirSync(outDir, { recursive: true });
  const r = await renderSlides(spec, { scale: cfg.exportScale, bg: true });
  const files: string[] = [];
  const pubs: Buffer[] = [];
  for (const s of r) {
    await contrastQA(s);
    const tag = String(s.qc.slide).padStart(2, '0');
    const { W, H } = s.qc;
    fs.writeFileSync(path.join(outDir, `${tag}.png`), s.png); files.push(`${tag}.png`);
    const jpg = (w: number, h: number) => sharp(s.png).resize(w, h, { kernel: 'lanczos3' }).jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toBuffer();
    const j1080 = await jpg(W, H); fs.writeFileSync(path.join(outDir, `${tag}_1080.jpg`), j1080); files.push(`${tag}_1080.jpg`); pubs.push(j1080);
    if (cfg.exportScale > 2) { fs.writeFileSync(path.join(outDir, `${tag}_2160.jpg`), await jpg(W * 2, H * 2)); files.push(`${tag}_2160.jpg`); }
    if (spec.slides?.[s.qc.slide - 1]?.type === 'avatar') {   // كيف تبان بواتساب
      const S = 640, mask = Buffer.from(`<svg width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="#fff"/></svg>`);
      const c = await sharp(s.png).resize(S, S).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      fs.writeFileSync(path.join(outDir, `${tag}_whatsapp_640.jpg`), await sharp(s.png).resize(S, S).jpeg({ quality: 95 }).toBuffer());
      fs.writeFileSync(path.join(outDir, `${tag}_whatsapp_preview.png`), c); files.push(`${tag}_whatsapp_640.jpg`, `${tag}_whatsapp_preview.png`);
    }
  }
  if (pubs.length) {
    fs.writeFileSync(path.join(outDir, 'preview.jpg'), await contactSheet(pubs, 'grid')); files.push('preview.jpg');
    if (pubs.length > 1 && (spec.format || 'post') === 'post') { fs.writeFileSync(path.join(outDir, 'strip.jpg'), await contactSheet(pubs, 'strip')); files.push('strip.jpg'); }
  }
  if (extra.caption) {
    const tags = (extra.hashtags || []).join(' ');
    fs.writeFileSync(path.join(outDir, 'caption.txt'), extra.caption.trim() + (tags ? '\n\n' + tags : '') + '\n'); files.push('caption.txt');
  }
  const sc = scoreOf(r.map(x => x.qc));
  fs.writeFileSync(path.join(outDir, 'qc.json'), JSON.stringify({ ...sc, slides: r.map(x => ({ ...x.qc, texts: undefined })) }, null, 1));
  fs.writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(extra.rawSpec ?? spec, null, 1));
  files.push('qc.json', 'spec.json');
  if (BLOB) {   // على Vercel: ZIP جاهز بالتخزين + كل الملفات (التحميل برابط موقّع مباشر)
    await zipToFile(outDir, files, path.join(outDir, 'post.zip')); files.push('post.zip');
    await persistMany(files.map(f => path.join(outDir, f)));
  }
  return { files, ...sc };
}
export function zipToFile(dir: string, files: string[], out: string) {
  return new Promise<void>((res, rej) => {
    const ws = fs.createWriteStream(out); ws.on('close', () => res()); ws.on('error', rej);
    zipDir(dir, files, ws).catch(rej);
  });
}

export function zipDir(dir: string, files: string[], res: NodeJS.WritableStream) {
  const z = new ZipArchive({ zlib: { level: 6 } });
  z.pipe(res);
  for (const f of files) if (fs.existsSync(path.join(dir, f))) z.file(path.join(dir, f), { name: f });
  return z.finalize();
}

export async function closeRenderer() { if (browserP) (await browserP).close().catch(() => {}); }
