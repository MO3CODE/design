// توليد وتعديل العناصر والصور بـ GPT Image.
// النص (قراءة التصميم، كتابة البرومبت، ترجمة التعديلات) بموديل GPT من RadoxAI؛ رسم الصورة نفسها عبر OpenAI
// (RadoxAI حالياً ما يدعم /images — جرّبناه: 404، والموديلات النصية ترفض modalities:image). لو أضافوه: imageProvider = radox.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../settings.js';
import { record } from '../usage.js';
import { chat, extractJSON, type Msg } from './provider.js';
import { listModels, resolveTier } from './router.js';
import { probe } from '../photos.js';
import { mutate, findPost, getProject, postDir, uid, now, HttpError, type Photo } from '../store.js';

export type GenKind = 'element' | 'photo' | 'background' | 'layer';
export interface GenReq { description: string; kind: GenKind; aspect?: string; quality?: string; n?: number; refs?: string[]; prompt?: string }

// مضاعفات 16 وضمن حد الجودة غير التجريبي (≤ 2560×1440 بكسل)
export const SIZES: Record<string, string> = { '1:1': '1920x1920', '4:5': '1536x1920', '3:4': '1440x1920', '9:16': '1152x2048', '16:9': '2048x1152', '3:2': '1920x1280', '2:3': '1280x1920' };
export function nearestAspect(ratio: number) {
  let best = '1:1', d = 9;
  for (const k of Object.keys(SIZES)) { const [a, b] = k.split(':').map(Number); const dd = Math.abs(Math.log(a / b / ratio)); if (dd < d) { d = dd; best = k; } }
  return best;
}
const isTransparent = (k: GenKind) => k === 'element' || k === 'layer';

/** موديل الجزء النصي من الصور: الإعدادات ← GPT من RadoxAI (يقرأ الصور) ← المستوى البصري */
export async function assetModel(): Promise<string> {
  const s = getSettings();
  if (s.assetModel) return s.assetModel;
  const { list } = await listModels();
  for (const re of [/^gpt-5\.6-sol$/, /^gpt-5\.6/, /^gpt-5\.5$/, /^gpt-5/]) { const m = list.find(x => re.test(x.id)); if (m) return m.id; }
  return resolveTier('vision');
}

/** استدعاء نصي للصور (برومبت/خطة/تعديل) مع تسجيل الصرف */
export async function textCall(task: string, system: string, messages: Msg[], pid?: string, postId?: string, maxTokens = 6000): Promise<any> {
  const model = await assetModel();
  const t0 = Date.now();
  const res = await chat({ model, system: [system], messages, json: true, maxTokens, effort: 'medium' });
  record({ kind: 'chat', task, tier: 'asset', model: res.model, project: pid, post: postId, usage: res.usage, ok: true, ms: Date.now() - t0 });
  return extractJSON(res.text);
}

export const STYLE = `Style rules for every image (Investor Gate — premium Saudi business services; the client HATES the generic AI look):
- Believable editorial photography: real materials, natural light, true proportions, subtle imperfections, real camera/lens feel.
- NO text, letters, numbers, Arabic script, logos, watermarks or UI — typography is added later by the design engine.
- No glossy CGI, plastic skin, oversaturation or fantasy. Calm luxury palette when relevant: ivory #F4F1E9, sand, muted gold #A29265, charcoal #26272A.
- Saudi context accurate and respectful (correct thobe/shemagh/igal, modest attire, real Riyadh architecture).
- element: ONE isolated subject, centered, fully visible with margin, clean edges, no ground plane, no cast shadow, transparent background.
- layer: a background layer with a TRANSPARENT backdrop (e.g. skyline/architecture silhouette, building, landscape strip, soft light shapes) meant to sit behind the content; keep the upper area empty/transparent for headlines.
- photo: complete photograph with calm negative space in the upper third.
- background: opaque atmospheric background with large calm empty areas.`;

const PROMPT_SYS = `You write prompts for OpenAI GPT Image. ${STYLE}\nReturn JSON only: {"prompt":"..."}`;

export async function buildPrompt(r: GenReq, pid?: string, postId?: string): Promise<string> {
  try {
    const j = await textCall('image_prompt', PROMPT_SYS, [{ role: 'user', content: `kind=${r.kind}\naspect=${r.aspect || 'auto'}\nالوصف:\n${r.description}` }], pid, postId, 4000);
    const p = String(j.prompt || '').trim(); if (p.length > 20) return p;
  } catch (e) { console.warn('[image prompt]', (e as Error).message); }
  return `${r.description}. ${isTransparent(r.kind) ? 'Isolated, transparent background, no shadow.' : 'Calm negative space for a headline.'} Photorealistic, natural light, real materials. No text, no letters, no logos.`;
}

/* ── استدعاء GPT Image (توليد أو تعديل بمرجع) ── */
interface ImgCall { prompt: string; size: string; quality?: string; n?: number; transparent: boolean; inputs?: string[] }
async function imageAPI(c: ImgCall, pid: string, postId: string, task: string) {
  const s = getSettings();
  const viaRadox = s.imageProvider === 'radox';
  const key = viaRadox ? s.radoxKey : s.openaiKey;
  const base = (viaRadox ? s.radoxBaseUrl : s.openaiBaseUrl).replace(/\/$/, '');
  if (!key) throw new HttpError(400, 'أضف مفتاح OpenAI من الإعدادات لرسم الصور (RadoxAI ما يدعم توليد الصور حالياً)');
  const t0 = Date.now(); let res: Response;
  if (c.inputs?.length) {
    const fd = new FormData();
    fd.append('model', s.imageModel); fd.append('prompt', c.prompt); fd.append('n', String(c.n || 1)); fd.append('size', c.size);
    fd.append('quality', c.quality || s.imageQuality || 'high'); fd.append('output_format', 'png'); if (c.transparent) fd.append('background', 'transparent');
    for (const f of c.inputs.slice(0, 4)) {
      const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png';
      fd.append('image[]', new Blob([fs.readFileSync(f)], { type: `image/${ext}` }), path.basename(f));
    }
    res = await fetch(base + '/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
  } else {
    res = await fetch(base + '/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.imageModel, prompt: c.prompt, n: c.n || 1, size: c.size, quality: c.quality || s.imageQuality || 'high', output_format: 'png',
        ...(c.transparent ? { background: 'transparent' } : {}) }),
    });
  }
  if (!res.ok) {
    let m = `${res.status}`; try { const j = await res.json(); m = j?.error?.message || m; } catch {}
    if (viaRadox && res.status === 404) m = 'RadoxAI ما يدعم توليد الصور — غيّر «مزوّد رسم الصور» لـ OpenAI بالإعدادات';
    throw new HttpError(res.status === 401 ? 401 : res.status === 400 ? 400 : 502, `GPT Image: ${m}`);
  }
  const j = await res.json(); const u = j.usage || {};
  const usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.input_tokens_details?.cached_tokens || 0, cacheWrite: 0,
    images: (j.data || []).length, imageIn: u.input_tokens_details?.image_tokens || 0 };
  record({ kind: 'image', task, tier: 'image', model: s.imageModel, project: pid, post: postId, usage, ok: true, ms: Date.now() - t0 });
  const bufs = (j.data || []).filter((d: any) => d.b64_json).map((d: any) => Buffer.from(d.b64_json, 'base64'));
  if (!bufs.length) throw new HttpError(502, 'GPT Image ما رجّع صور');
  return bufs as Buffer[];
}

async function savePhotos(pid: string, postId: string, bufs: Buffer[], meta: Partial<Photo> & { baseName: string }): Promise<Photo[]> {
  const dir = path.join(postDir(pid, postId), 'photos'); fs.mkdirSync(dir, { recursive: true });
  const out: Photo[] = [];
  for (const [i, b] of bufs.entries()) {
    const id = uid(8), file = `${id}.png`, f = path.join(dir, file);
    fs.writeFileSync(f, b);
    const info = await probe(f);
    const { baseName, ...rest } = meta;
    out.push({ id, name: `${baseName}${bufs.length > 1 ? '_' + (i + 1) : ''}.png`, file, ...info, bytes: b.length, uploadedAt: now(), source: 'gpt-image', ...rest });
  }
  await mutate(pid, p => { findPost(p, postId).photos.push(...out); });
  return out;
}

/** توليد يدوي من وصف (نافذة «ولّد») */
export async function generate(pid: string, postId: string, r: GenReq): Promise<{ photos: Photo[]; prompt: string }> {
  const post = findPost(getProject(pid), postId);
  const prompt = r.prompt?.trim() || await buildPrompt(r, pid, postId);
  const size = SIZES[r.aspect || ''] || (r.kind === 'element' ? SIZES['1:1'] : SIZES['4:5']);
  const refs = (r.refs || []).map(id => post.photos.find(p => p.id === id)).filter(Boolean) as Photo[];
  const bufs = await imageAPI({ prompt, size, quality: r.quality, n: Math.max(1, Math.min(4, Number(r.n) || 1)), transparent: isTransparent(r.kind),
    inputs: refs.map(p => path.join(postDir(pid, postId), 'photos', p.file)) }, pid, postId, refs.length ? 'image_edit' : 'image');
  const photos = await savePhotos(pid, postId, bufs, { baseName: `gpt-image_${r.kind}`, note: r.description.slice(0, 120), prompt,
    asset: { kind: r.kind, description: r.description, rev: 1, history: [{ at: now(), instruction: r.description, prompt }] } });
  return { photos, prompt };
}

/** تعديل نفس الأصل بتعليمات عربية → نسخة جديدة منه (revision) مربوطة بالأصل */
export async function editPhoto(pid: string, postId: string, photoId: string, instruction: string): Promise<Photo> {
  const post = findPost(getProject(pid), postId);
  const ph = post.photos.find(p => p.id === photoId);
  if (!ph) throw new HttpError(404, 'الصورة غير موجودة');
  const kind: GenKind = (ph.asset?.kind as GenKind) || (ph.alpha ? 'element' : 'photo');
  let prompt = '';
  try {
    const j = await textCall('image_edit_prompt',
      `You turn an Arabic edit request into a precise GPT Image EDIT instruction for the attached image. Keep everything the user did not ask to change
(subject identity, pose, framing, lighting, style, transparent background). ${STYLE}\nReturn JSON only: {"prompt":"..."}`,
      [{ role: 'user', content: `kind=${kind}\nالبرومبت الأصلي: ${ph.prompt || ph.asset?.description || ph.note || '—'}\nالتعديل المطلوب (بالعربي): ${instruction}` }], pid, postId, 3000);
    prompt = String(j.prompt || '').trim();
  } catch (e) { console.warn('[edit prompt]', (e as Error).message); }
  if (prompt.length < 10) prompt = `Edit this image: ${instruction}. Keep subject, framing and style unchanged.${ph.alpha ? ' Keep the transparent background.' : ''} No text, no logos.`;
  const size = SIZES[nearestAspect(ph.aspect)];
  const [buf] = await imageAPI({ prompt, size, transparent: ph.alpha, inputs: [path.join(postDir(pid, postId), 'photos', ph.file)] }, pid, postId, 'image_edit');
  const root = ph.asset?.root || ph.id;
  const [np] = await savePhotos(pid, postId, [buf], {
    baseName: `${(ph.name || 'asset').replace(/(_r\d+)?\.png$/i, '')}_r${(ph.asset?.rev || 1) + 1}`, note: instruction.slice(0, 120), prompt,
    asset: { ...(ph.asset || { kind }), kind, root, parent: ph.id, rev: (ph.asset?.rev || 1) + 1,
      history: [...(ph.asset?.history || [{ at: ph.uploadedAt, instruction: ph.note || '', prompt: ph.prompt || '' }]), { at: now(), instruction, prompt }] },
  });
  return np;
}

/* ═════════ أصول تلقائية: يقرأ التصميم ويقرر الأصل المناسب ويولّده ويركّبه ═════════ */
export const PLAN_SYS = `أنت مدير فني يقرأ تصميم سوشال جاهز (صورة الشرائح + spec المحرك + المحتوى) ويقرر الأصول البصرية الناقصة اللي ترفع التصميم،
ثم تكتب لكل أصل برومبت GPT Image ومكانه بالـ spec.
أنواع الأصل:
- element: عنصر بطل/داعم معزول بخلفية شفافة (شخص، ملف، ختم، مفتاح، مبنى…) — يوضع بـ slides[i].photo مثل:
  {"area":"cutout","side":"center","h":0.5,"bottom":100,"treat":"none","grain":0,"fade_bottom":0.2}
- layer: طبقة خلفية **بخلفية شفافة** تقعد خلف المحتوى (أفق الرياض، مبنى، معمار، شريط مشهد) — توضع بـ slides[i].bg_photo مثل:
  {"treat":"none","grain":0,"blend":"normal","opacity":0.9,"pos":"center bottom","size":"100% auto","fade":"top"}
قواعد: لا تغيّر النصوص. لا تكرر أصل موجود. أصل واحد لكل شريحة كحد أقصى، و3 أصول كحد أقصى. الأصل يخدم فكرة المنشور ولون الخدمة.
لو الشريحة فيها أصل مناسب أصلاً لا تضيف لها. الأحجام بالنسبة لكانفس 1080×1350 (منشور).
${STYLE}
أرجع JSON فقط:
{"assets":[{"slide":1,"kind":"element|layer","why":"سطر بالعربي ليش","description":"وصف عربي قصير","prompt":"English GPT Image prompt","aspect":"1:1|4:5|3:4|2:3|9:16|16:9|3:2","field":"photo|bg_photo","value":{...حقول المحرك بدون src}}]}`;

export interface PlannedAsset { slide: number; kind: 'element' | 'layer'; why: string; description: string; prompt: string; aspect: string; field: 'photo' | 'bg_photo'; value: any }

export async function generateAsset(pid: string, postId: string, a: PlannedAsset): Promise<Photo> {
  const size = SIZES[a.aspect] || (a.kind === 'element' ? SIZES['1:1'] : SIZES['3:2']);
  const [buf] = await imageAPI({ prompt: a.prompt, size, transparent: true }, pid, postId, 'image');
  const [p] = await savePhotos(pid, postId, [buf], { baseName: `asset_s${a.slide}_${a.kind}`, note: a.description.slice(0, 120), prompt: a.prompt,
    asset: { kind: a.kind, description: a.description, rev: 1, slide: a.slide, field: a.field, history: [{ at: now(), instruction: a.description, prompt: a.prompt }] } });
  return p;
}
