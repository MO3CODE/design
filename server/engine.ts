// المحرك: الإعدادات المعتمدة (presets) + أصول الهوية + تجهيز spec للرسم — نفس build.py بالمهارة
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { ENGINE, DATA, cfg } from './config.js';
import { prepPhoto } from './photos.js';
import { fileUrl, ensureLocal, persist, BLOB, listKeys } from './storage.js';
import { postDir, type Post } from './store.js';

export const readJSON = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const brand = () => readJSON(path.join(ENGINE, 'brand.json'));
export const presets = () => readJSON(path.join(ENGINE, 'presets.json'));

export function deepMerge(base: any, over: any): any {
  if (!isObj(base) || !isObj(over)) return over !== undefined && over !== null ? over : base;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** يدمج preset + slide_defaults + topline المشترك (spec القيم تغلب) */
export function resolvePreset(spec0: any): any {
  let spec = clone(spec0);
  if (spec.preset) {
    const P = presets()[spec.preset];
    if (!P) throw new Error(`preset غير معروف: ${spec.preset}`);
    spec = deepMerge(P.spec || {}, spec);
    const sd = P.slide_defaults || {};
    spec.slides = (spec.slides || []).map((sl: any) => deepMerge(deepMerge(sd['*'] || {}, sd[sl.type] || {}), sl));
  }
  if (spec.topline) for (const sl of spec.slides || []) if (sl.topline === undefined) sl.topline = spec.topline;
  return spec;
}

/* ── أصول المحرك (روابط http يخدمها السيرفر نفسه — تشتغل بالمتصفح وبكروم الرسم) ── */
const A = (f: string) => '/engine/assets/' + f.split('/').map(encodeURIComponent).join('/');
let assetsCache: any;
export function engineAssets() {
  if (assetsCache) return assetsCache;
  const logo: Record<string, string> = {};
  for (const f of fs.readdirSync(path.join(ENGINE, 'assets', 'logo'))) if (f.endsWith('.svg')) logo[f.replace('.svg', '')] = A('logo/' + f);
  const geoP = path.join(ENGINE, 'assets', 'geo', 'mena.json');
  assetsCache = {
    fonts: {
      bahij: { 300: 'Bahij_TheSansArabic-Light.ttf', 400: 'Bahij_TheSansArabic-Plain.ttf', 600: 'Bahij_TheSansArabic-SemiBold.ttf', 700: 'Bahij_TheSansArabic-Bold.ttf', 800: 'Bahij_TheSansArabic-ExtraBold.ttf', 900: 'Bahij_TheSansArabic-Black.ttf' },
      plex: { 300: 'IBMPlexSansArabic-Light.ttf', 400: 'IBMPlexSansArabic-Regular.ttf', 500: 'IBMPlexSansArabic-Medium.ttf', 600: 'IBMPlexSansArabic-SemiBold.ttf', 700: 'IBMPlexSansArabic-Bold.ttf' },
      cairo: { 500: 'cairo-medium.ttf', 800: 'cairo-extra-bold.ttf' },
      expo: { 300: 'Expo Arabic Light.ttf', 400: 'Expo Arabic Book.ttf', 500: 'Expo Arabic Medium.ttf', 600: 'ExpoArabic-SemiBold.ttf', 700: 'Expo Arabic Bold.ttf', 800: 'Expo Arabic Bold.ttf', 900: 'Expo Arabic Bold.ttf' },
      thsans: { 300: 'thmanyahsans-Light.otf', 400: 'thmanyahsans-Regular.otf', 500: 'thmanyahsans-Medium.otf', 600: 'thmanyahsans-Medium.otf', 700: 'thmanyahsans-Bold.otf', 800: 'thmanyahsans-Bold.otf', 900: 'thmanyahsans-Black.otf' },
      thserif: { 300: 'thmanyahserifdisplay-Light.otf', 400: 'thmanyahserifdisplay-Regular.otf', 500: 'thmanyahserifdisplay-Medium.otf', 600: 'thmanyahserifdisplay-Medium.otf', 700: 'thmanyahserifdisplay-Bold.otf', 800: 'thmanyahserifdisplay-Bold.otf', 900: 'thmanyahserifdisplay-Black.otf' },
    },
    fontBase: '/engine/assets/fonts/',
    icons: { regular: A('icons/tabler-icons.woff2'), thin: A('icons/tabler-icons-200.woff2'), filled: A('icons/tabler-icons-filled.woff2') },
    iconmap: readJSON(path.join(ENGINE, 'assets', 'icons', 'map.json')),
    logo,
    logoMeta: readJSON(path.join(ENGINE, 'assets', 'logo', 'meta.json')),
    tex: Object.fromEntries(['paper', 'paper_soft', 'grain', 'mottle', 'linen', 'stucco', 'cotton'].map(k => [k, A(`textures/${k}.png`)])),
    geo: fs.existsSync(geoP) ? readJSON(geoP) : null,
    svg: {
      motif_arrow: fs.readFileSync(path.join(ENGINE, 'assets', 'logo', 'motif_arrow.svg'), 'utf8'),
      motif_outline: fs.readFileSync(path.join(ENGINE, 'assets', 'logo', 'motif_outline.svg'), 'utf8'),
    },
  };
  return assetsCache;
}

/* ── الخطوط: المجانية داخل الريبو؛ التجارية (Expo/Bahij) تُرفع من الإعدادات للتخزين (_fonts/) أو مجلد FONTS_DIR محلياً ── */
let uploadedFonts = new Set<string>(); let fontsAt = 0;
export async function refreshFonts(maxAgeMs = 60000) {
  if (Date.now() - fontsAt < maxAgeMs) return;
  fontsAt = Date.now();
  uploadedFonts = new Set((await listKeys('_fonts/').catch(() => [])).map(k => k.slice('_fonts/'.length)));
}
const bundled = (f: string) => fs.existsSync(path.join(ENGINE, 'assets', 'fonts', f)) || (!!cfg.fontsDir && fs.existsSync(path.join(cfg.fontsDir, f)));
const fontUrl = (f: string) => bundled(f) || !uploadedFonts.has(f) ? `${engineAssets().fontBase}${encodeURIComponent(f)}` : `/files/_fonts/${encodeURIComponent(f)}`;

/** الخطوط المتوفرة فعلاً (لو ناقصة يرجع المحرك لـ IBM Plex) */
export function fontStatus() {
  const F = engineAssets().fonts; const out: Record<string, boolean> = {};
  for (const [k, ws] of Object.entries<any>(F)) out[k] = Object.values<string>(ws).every(f => bundled(f) || uploadedFonts.has(f));
  return out;
}
export function fontFiles() { return [...new Set(Object.values<any>(engineAssets().fonts).flatMap(ws => Object.values<string>(ws)))]; }

export function fontCSS() {
  const Ax = engineAssets();
  const fam: Record<string, string> = { bahij: 'Bahij', plex: 'Plex', cairo: 'Cairo', expo: 'Expo', thsans: 'ThSans', thserif: 'ThSerif' };
  let css = '';
  for (const [k, ws] of Object.entries<any>(Ax.fonts)) for (const [w, f] of Object.entries<string>(ws))
    css += `@font-face{font-family:'${fam[k]}';font-weight:${w};src:url("${fontUrl(f)}")}\n`;
  css += `@font-face{font-family:'tabler';src:url("${Ax.icons.regular}")}@font-face{font-family:'tabler-thin';src:url("${Ax.icons.thin}")}@font-face{font-family:'tabler-f';src:url("${Ax.icons.filled}")}
.ti{font-family:'tabler';font-style:normal;line-height:1;display:inline-block}.tif{font-family:'tabler-f';font-style:normal;line-height:1;display:inline-block}.tit{font-family:'tabler-thin';font-style:normal;line-height:1;display:inline-block}`;
  return css;
}

/* ── تجهيز spec للرسم: preset + الصور (تدريج/قص) + QR → روابط ── */
export { fileUrl } from './storage.js';

/* ── مكتبة الصور المشتركة (صور حقيقية من Unsplash — خلفيات المملكة وتوقيع وأشخاص) متاحة لكل المنشورات ── */
export const LIBRARY: Record<string, string> = {
  kingdom_blue: 'برج المملكة على سماء زرقاء (خلفية المملكة المعتمدة — bg_photo mono)',
  kingdom_sunset: 'برج المملكة وقت الغروب بسماء برتقالية',
  faisaliah: 'برج الفيصلية (طولي)',
  tower_bw: 'برج المملكة أبيض وأسود (طولي)',
  car_window: 'أفق الرياض مع نخيل وسيارات',
  signing_office: 'رجلين يوقعان أوراق على طاولة مكتب',
  signing_warm: 'يد تكتب على ورقة (دافئ)',
  signing_dark: 'رجل يوقع مستند بقلم (داكن، طولي)',
  saudi_man: 'رجل بثوب أبيض واقف (طولي)',
  bisht: 'رجل بلبس تقليدي وبشت بني',
  man_bw: 'رجل أبيض وأسود',
};
const LIB_DIR = path.join(ENGINE, 'library');

function findPhoto(post: Post, src: string): { abs: string; alpha: boolean } | null {
  const s = String(src || '').replace(/^photos[\/]/, '').trim();
  const p = post.photos.find(x => x.id === s || x.name === s || x.file === s || x.name.replace(/\.[^.]+$/, '') === s.replace(/\.[^.]+$/, ''));
  if (p) return { abs: p.file, alpha: p.alpha };
  const stem = s.replace(/^lib:/, '').replace(/\.[^.]+$/, '');
  if (LIBRARY[stem] && fs.existsSync(path.join(LIB_DIR, stem + '.jpg'))) return { abs: path.join(LIB_DIR, stem + '.jpg'), alpha: false };
  return null;
}

export interface PrepareOut { spec: any; warnings: string[] }

export async function prepareSpec(pid: string, post: Post, spec0: any): Promise<PrepareOut> {
  const spec = resolvePreset(spec0);
  const warnings: string[] = [];
  const dir = postDir(pid, post.id), work = path.join(dir, 'prep');

  const doPhoto = async (ph: any, defTreat: string) => {
    if (!ph || !ph.src) return;
    const p = findPhoto(post, ph.src);
    if (!p) { warnings.push(`الصورة غير موجودة (تخطيتها): ${ph.src}`); for (const k of Object.keys(ph)) delete ph[k]; return; }
    const src = path.isAbsolute(p.abs) ? p.abs : await ensureLocal(path.join(dir, 'photos', p.abs));
    if (!src) { warnings.push(`ملف الصورة مفقود بالتخزين: ${ph.src}`); for (const k of Object.keys(ph)) delete ph[k]; return; }
    const cut = (ph.cutout ?? ph.area === 'cutout') === true || ph.cutout === true;
    try {
      const r = await prepPhoto(src, work, { treat: ph.treat || defTreat, grain: ph.grain ?? 0.06, cutout: cut && !p.alpha, crop: ph.crop });
      ph._file = fileUrl(r.file); ph._aspect = r.aspect;
      if (ph.fg) {
        try { const fg = await prepPhoto(src, work, { treat: ph.treat || defTreat, grain: ph.grain ?? 0.06, cutout: true, crop: ph.crop, nocrop: true }); ph._fg = fileUrl(fg.file); }
        catch (e: any) { warnings.push('الطبقة الأمامية (fg) ما تجهزت: ' + e.message); delete ph.fg; }
      }
    } catch (e: any) {
      warnings.push(e.message);
      const r = await prepPhoto(src, work, { treat: ph.treat || defTreat, grain: ph.grain ?? 0.06 });   // بدون قص — المسودة تكمل
      ph._file = fileUrl(r.file); ph._aspect = r.aspect;
    }
  };

  const slides = spec.slides || [spec];
  for (const sl of slides) {
    const theme = sl.theme || spec.theme || 'noir';
    const dt = ['noir', 'graphite'].includes(theme) ? 'noir' : theme === 'sepia' ? 'sepia' : theme.startsWith('svc_') || theme === 'ivory' ? 'natural' : 'warm';
    await doPhoto(sl.photo, dt);
    if (sl.bg_photo) await doPhoto(sl.bg_photo, sl.bg_photo.treat || 'mono');
    for (const sec of sl.sections || []) await doPhoto(sec.photo, dt);
    if (sl.hero) await doPhoto(sl.hero.photo, dt);
    if (sl.device?.src) { const p = findPhoto(post, sl.device.src); if (p && !path.isAbsolute(p.abs)) sl.device._file = fileUrl(path.join(dir, 'photos', p.abs)); }
    if (sl.qr) {
      const q = path.join(work, `qr_${crypto.createHash('md5').update(String(sl.qr)).digest('hex').slice(0, 8)}.png`);
      if (!fs.existsSync(q)) { fs.mkdirSync(work, { recursive: true }); await QRCode.toFile(q, String(sl.qr), { margin: 1, scale: 20, errorCorrectionLevel: 'M', color: { dark: '#2B241A', light: '#FFFFFF' } }); await persist(q); }
      sl._qr = fileUrl(q);
    }
  }
  for (const e of spec.span || []) if (e.kind === 'photo') await doPhoto(e, 'none');
  return { spec, warnings };
}
