// تجهيز الصور — نفس scripts/prep_photo.py: تدريج لوني بألوان الهوية + حبيبات فيلم + قص الأصل الشفاف لحدوده
// + قص الخلفية (rembg) عبر بايثون لو متوفر. الناتج يُخزَّن (cache) حسب الإعدادات.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { cfg, ENGINE } from './config.js';
import { BLOB, keyOf, readJSON, exists, persist } from './storage.js';

export interface PrepOpts { treat?: string; grain?: number; cutout?: boolean; crop?: number[]; nocrop?: boolean }
export interface PrepResult { file: string; w: number; h: number; aspect: number; alpha: boolean; cutoutModel?: string }

let pyOk: boolean | null = null;
let pyCheck: Promise<boolean> | null = null;
/** فحص بايثون + rembg بالخلفية (الاستيراد ياخذ ثواني — ما نوقف السيرفر عشانه) */
export function checkCutout(): Promise<boolean> {
  if (process.env.VERCEL) return Promise.resolve(false);   // ما فيه بايثون على Vercel — الأصول ترتفع PNG مقصوصة
  if (!pyCheck) pyCheck = new Promise<boolean>(res => {
    try {
      const p = spawn(cfg.python, ['-c', 'import rembg, numpy, PIL; print("ok")']);
      let out = ''; p.stdout.on('data', d => (out += d));
      p.on('error', () => res(false)); p.on('close', code => res(code === 0 && out.includes('ok')));
      setTimeout(() => { p.kill(); res(false); }, 90000);
    } catch { res(false); }
  }).then(v => (pyOk = v));
  return pyCheck;
}
export function cutoutAvailable(): boolean { if (pyOk === null) checkCutout(); return !!pyOk; }

/** معلومات صورة مرفوعة (الأبعاد + هل فيها شفافية فعلية) */
export async function probe(file: string) {
  const img = sharp(file, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  let alpha = false;
  if (meta.hasAlpha) {
    const st = await sharp(file).ensureAlpha().stats();
    alpha = (st.channels[3]?.min ?? 255) < 250;
  }
  const swap = (meta.orientation || 1) >= 5;
  const w = (swap ? meta.height : meta.width) || 1, h = (swap ? meta.width : meta.height) || 1;
  return { w, h, aspect: +(w / h).toFixed(4), alpha };
}

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
type Stops = [number, number[]][];
const S = (a: [number, string][]): Stops => a.map(([p, c]) => [p, hex(c)]);
const TONES: Record<string, Stops> = {
  noir: S([[0, '#0E0B08'], [0.35, '#3A2E20'], [0.7, '#B79A6B'], [1, '#F6E6C4']]),
  gold: S([[0, '#2A1F12'], [0.5, '#B58E57'], [1, '#FBEBCB']]),
  sepia: S([[0, '#2F2a1E'], [0.55, '#8F8160'], [1, '#EDE5CF']]),
};
function interp(stops: Stops, x: number, ch: number) {
  if (x <= stops[0][0]) return stops[0][1][ch];
  for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
    const [p0, c0] = stops[i - 1], [p1, c1] = stops[i]; const t = (x - p0) / (p1 - p0);
    return c0[ch] + (c1[ch] - c0[ch]) * t;
  }
  return stops[stops.length - 1][1][ch];
}
const curve = (x: number, lift: number, gain: number, contrast: number) =>
  Math.min(1, Math.max(0, lift + ((x - 0.5) * contrast + 0.5) * (gain - lift)));
const MONO = hex('#FFF8EC');

function grade(buf: Buffer, ch: number, treat: string) {
  if (treat === 'none') return;
  for (let i = 0; i < buf.length; i += ch) {
    const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let o: number[];
    if (treat === 'noir') {
      const t = [0, 1, 2].map(c => interp(TONES.noir, L, c)); const src = [r, g, b];
      o = t.map((v, c) => curve(v * 0.78 + (L * 0.25 + src[c] * 0.75) * 0.22, 0.02, 0.97, 1.1));
    } else if (treat === 'gold') {
      const src = [r, g, b]; o = [0, 1, 2].map(c => curve(interp(TONES.gold, L, c) * 0.72 + src[c] * 0.28, 0.04, 0.98, 1.05));
    } else if (treat === 'sepia') {
      o = [0, 1, 2].map(c => curve(interp(TONES.sepia, L, c), 0.06, 0.95, 0.95));
    } else if (treat === 'mono') {
      const v = curve(L, 0.05, 0.96, 1.08); o = [v * MONO[0], v * MONO[1], v * MONO[2]];
    } else if (treat === 'warm') {
      const k = [1.04, 1.0, 0.9]; o = [r, g, b].map((c, j) => curve((L + (c - L) * 0.8) * k[j], 0.03, 0.98, 1.03));
    } else {   // natural
      o = [r, g, b].map(c => curve(c, 0.015, 0.99, 1.02));
    }
    buf[i] = Math.round(Math.min(1, Math.max(0, o[0])) * 255);
    buf[i + 1] = Math.round(Math.min(1, Math.max(0, o[1])) * 255);
    buf[i + 2] = Math.round(Math.min(1, Math.max(0, o[2])) * 255);
  }
}

async function grain(buf: Buffer, w: number, h: number, ch: number, amount: number) {
  if (amount <= 0) return;
  let s = 7 >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Buffer.alloc(w * h);
  for (let i = 0; i < n.length; i++) {   // ضوضاء طبيعية (Box–Muller) ثم تنعيم بسيط زي حبيبات الفيلم
    const u = Math.max(1e-9, rnd()), v = rnd();
    n[i] = Math.max(0, Math.min(255, Math.round(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 40 + 128)));
  }
  const nb = await sharp(n, { raw: { width: w, height: h, channels: 1 } }).blur(0.6).raw().toBuffer();
  for (let p = 0, i = 0; p < nb.length; p++, i += ch) {
    const L = (buf[i] + buf[i + 1] + buf[i + 2]) / 765;
    const wgt = amount * (1.2 - Math.abs(L - 0.5) * 1.2), d = (nb[p] / 255 - 0.5) * wgt * 255;
    buf[i] = clamp(buf[i] + d); buf[i + 1] = clamp(buf[i + 1] + d); buf[i + 2] = clamp(buf[i + 2] + d);
  }
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function alphaBBox(buf: Buffer, w: number, h: number, thr: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function runPy(args: string[]): Promise<any> {
  return new Promise((res, rej) => {
    const p = spawn(cfg.python, [path.join(ENGINE, 'python', 'prep_photo.py'), ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('error', rej);
    p.on('close', code => {
      if (code) return rej(new Error('قص الخلفية فشل: ' + err.slice(-400)));
      try { res(JSON.parse(out.trim().split('\n').pop()!)); } catch { rej(new Error('ناتج بايثون غير مفهوم: ' + out.slice(-200))); }
    });
  });
}

export async function prepPhoto(src: string, workDir: string, o: PrepOpts): Promise<PrepResult> {
  const treat = o.treat || 'natural', grainAmt = o.grain ?? 0.06;
  const st = fs.statSync(src);
  // على Vercel الملف ينزل لـ /tmp بكل جهاز (تاريخ تعديل مختلف) — نعتمد المسار والحجم (الصور ما تتعدّل، التعديل = صورة جديدة)
  const key = crypto.createHash('md5').update(JSON.stringify([BLOB ? keyOf(src) : src, BLOB ? st.size : st.mtimeMs, treat, grainAmt, !!o.cutout, o.crop || null, !!o.nocrop])).digest('hex').slice(0, 10);
  fs.mkdirSync(workDir, { recursive: true });
  const base = path.join(workDir, `${path.parse(src).name}_${treat}${o.cutout ? '_cut' : ''}_${key}`);
  const metaF = base + '.json';
  if (fs.existsSync(metaF)) { const m = JSON.parse(fs.readFileSync(metaF, 'utf8')); if (fs.existsSync(m.file)) return m; }
  if (BLOB) { const m = await readJSON<PrepResult>(keyOf(metaF)); if (m && await exists(m.file)) return m; }   // جاهزة من جهاز ثاني

  let input: string | Buffer = src, cutoutModel: string | undefined;
  const info = await probe(src);
  if (o.cutout && !info.alpha) {
    if (!(await checkCutout())) throw new Error('قص الخلفية يحتاج بايثون + rembg على السيرفر — ارفع الأصل PNG مقصوص، أو فعّل القص (راجع README)');
    const tmp = base + '_raw.png';
    const r = await runPy([src, tmp, '--treat', 'none', '--grain', '0', '--cutout', '--max', String(cfg.maxPhotoSide),
      ...(o.nocrop ? ['--nocrop'] : []), ...(o.crop ? ['--crop', o.crop.join(',')] : [])]);
    input = tmp; cutoutModel = r.cutout_model;
  }
  let img = sharp(input, { failOn: 'none' }).rotate();
  if (o.crop && input === src) {
    const [x0, y0, x1, y1] = o.crop;
    img = sharp(await img.toBuffer()).extract({ left: Math.round(x0 * info.w), top: Math.round(y0 * info.h),
      width: Math.max(1, Math.round((x1 - x0) * info.w)), height: Math.max(1, Math.round((y1 - y0) * info.h)) });
  }
  img = img.resize({ width: cfg.maxPhotoSide, height: cfg.maxPhotoSide, fit: 'inside', withoutEnlargement: true });
  const hasAlpha = info.alpha || !!cutoutModel;
  let { data, info: ri } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let w = ri.width, h = ri.height;
  if (hasAlpha && !(o.nocrop && cutoutModel)) {   // أصل مقصوص جاهز — قص الحدود الشفافة عشان الملاءمة تكون على الجسم نفسه
    const bb = alphaBBox(data, w, h, cutoutModel ? 24 : 8);
    if (bb && (bb.width < w || bb.height < h)) {
      const r2 = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extract(bb).raw().toBuffer({ resolveWithObject: true });
      data = r2.data; w = r2.info.width; h = r2.info.height;
    }
  }
  grade(data, 4, treat);
  await grain(data, w, h, 4, grainAmt);
  const out = base + (hasAlpha ? '.png' : '.jpg');
  const s = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  if (hasAlpha) await s.png({ compressionLevel: 8 }).toFile(out);
  else await s.removeAlpha().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(out);
  const res: PrepResult = { file: out, w, h, aspect: +(w / h).toFixed(4), alpha: hasAlpha, cutoutModel };
  fs.writeFileSync(metaF, JSON.stringify(res));
  await persist(out); await persist(metaF);
  if (typeof input === 'string' && input !== src) fs.rmSync(input, { force: true });
  return res;
}

/** صورة مصغّرة لإرسالها لـ Claude (رؤية) — أصغر حجم يكفي للفهم */
export async function thumbForAI(file: string, max = 768): Promise<{ data: string; media: 'image/png' | 'image/jpeg' }> {
  const m = await sharp(file).metadata();
  const img = sharp(file).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  if (m.hasAlpha) {   // الشفاف على خلفية رمادية فاتحة عشان يبان الشكل
    const buf = await img.flatten({ background: '#d9d6cf' }).jpeg({ quality: 82 }).toBuffer();
    return { data: buf.toString('base64'), media: 'image/jpeg' };
  }
  return { data: (await img.jpeg({ quality: 82 }).toBuffer()).toString('base64'), media: 'image/jpeg' };
}
