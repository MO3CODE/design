// توليد العناصر والصور بـ GPT Image (OpenAI مباشرة — RadoxAI ما يدعم توليد الصور).
// الوصف بالعربي ← موديل سريع يكتب برومبت إنجليزي بأسلوب الهوية ← GPT Image ← يُحفظ كصورة للمنشور جاهزة للتصميم.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../settings.js';
import { record } from '../usage.js';
import { chat, extractJSON } from './provider.js';
import { route } from './router.js';
import { probe } from '../photos.js';
import { mutate, findPost, getProject, postDir, uid, now, HttpError, type Photo } from '../store.js';

export type GenKind = 'element' | 'photo' | 'background';
export interface GenReq { description: string; kind: GenKind; aspect?: string; quality?: string; n?: number; refs?: string[]; prompt?: string }

// كل المقاسات مضاعفات 16 وضمن حد الجودة غير التجريبي (≤ 2560×1440 بكسل)
const SIZES: Record<string, string> = { '1:1': '1920x1920', '4:5': '1536x1920', '3:4': '1440x1920', '9:16': '1152x2048', '16:9': '2048x1152', '3:2': '1920x1280' };

const PROMPT_SYS = `You write prompts for OpenAI GPT Image for "Investor Gate" (بوابة المستثمر), a premium Saudi business-services firm
(company formation, foreign investors, premium residency, accounting, trademarks). The client HATES the generic AI look.
Write ONE English prompt that produces a believable, editorial, photographic result:
- Real materials and natural light, true-to-life proportions, subtle imperfections, shallow depth of field when relevant, shot on a real camera/lens.
- NO text, letters, numbers, Arabic script, logos, watermarks or UI — all typography is added later by the design engine.
- No glossy CGI, no plastic skin, no over-saturated colors, no fantasy. Calm luxury palette when relevant: ivory #F4F1E9, sand, muted gold #A29265, charcoal #26272A.
- Saudi context must be accurate and respectful (correct thobe/shemagh/igal, modest attire, real Riyadh architecture).
- kind=element: ONE isolated object or person, centered, fully visible with generous margin, clean edges, no ground plane, no cast shadow, transparent background.
- kind=photo: a complete photograph composed for a 4:5 social post, with calm negative space in the upper third for a headline.
- kind=background: an atmospheric background (architecture/texture/sky) with large empty areas and low detail where text will sit.
Return JSON only: {"prompt":"..."}`;

export async function buildPrompt(r: GenReq, pid?: string, postId?: string): Promise<string> {
  try {
    const rt = await route('caption');   // الموديل السريع يكفي لكتابة البرومبت
    const t0 = Date.now();
    const res = await chat({ model: rt.model, system: [PROMPT_SYS], json: true, maxTokens: 4000, effort: 'low',
      messages: [{ role: 'user', content: `kind=${r.kind}\naspect=${r.aspect || 'auto'}\nالوصف:\n${r.description}` }] });
    record({ kind: 'chat', task: 'image_prompt', tier: rt.tier, model: res.model, project: pid, post: postId, usage: res.usage, ok: true, ms: Date.now() - t0 });
    const p = String(extractJSON(res.text).prompt || '').trim();
    if (p.length > 20) return p;
  } catch (e) { console.warn('[image prompt]', (e as Error).message); }
  // احتياطي بدون موديل نصي
  const base = r.kind === 'element' ? 'Single isolated subject, centered, fully visible, transparent background, no shadow.'
    : r.kind === 'background' ? 'Atmospheric editorial background with large calm empty areas.' : 'Editorial photograph with calm negative space in the upper third.';
  return `${r.description}. ${base} Photorealistic, natural light, real materials, subtle imperfections. No text, no letters, no logos.`;
}

async function openaiError(r: Response) {
  let m = `${r.status}`; try { const j = await r.json(); m = j?.error?.message || m; } catch {}
  return new HttpError(r.status === 401 ? 401 : r.status === 400 ? 400 : 502, `GPT Image: ${m}`);
}

export async function generate(pid: string, postId: string, r: GenReq): Promise<{ photos: Photo[]; prompt: string; usage: any }> {
  const s = getSettings();
  if (!s.openaiKey) throw new HttpError(400, 'أضف مفتاح OpenAI من الإعدادات لتوليد الصور (RadoxAI ما يدعم توليد الصور)');
  const post = findPost(getProject(pid), postId);
  const prompt = r.prompt?.trim() || await buildPrompt(r, pid, postId);
  const n = Math.max(1, Math.min(4, Number(r.n) || 1));
  const size = SIZES[r.aspect || ''] || (r.kind === 'element' ? SIZES['1:1'] : SIZES['4:5']);
  const quality = r.quality || s.imageQuality || 'high';
  const transparent = r.kind === 'element';
  const base = s.openaiBaseUrl.replace(/\/$/, '');
  const refs = (r.refs || []).map(id => post.photos.find(p => p.id === id)).filter(Boolean) as Photo[];
  const t0 = Date.now();
  let res: Response;
  if (refs.length) {   // بمرجع: نفس الشخص/المنتج/الأسلوب
    const fd = new FormData();
    fd.append('model', s.imageModel); fd.append('prompt', prompt); fd.append('n', String(n)); fd.append('size', size);
    fd.append('quality', quality); fd.append('output_format', 'png'); if (transparent) fd.append('background', 'transparent');
    for (const p of refs.slice(0, 4)) {
      const buf = fs.readFileSync(path.join(postDir(pid, postId), 'photos', p.file));
      const ext = path.extname(p.file).slice(1).replace('jpg', 'jpeg') || 'png';
      fd.append('image[]', new Blob([buf], { type: `image/${ext}` }), p.file);
    }
    res = await fetch(base + '/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${s.openaiKey}` }, body: fd });
  } else {
    res = await fetch(base + '/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${s.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.imageModel, prompt, n, size, quality, output_format: 'png', ...(transparent ? { background: 'transparent' } : {}) }),
    });
  }
  if (!res.ok) throw await openaiError(res);
  const j = await res.json();
  const u = j.usage || {};
  const usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.input_tokens_details?.cached_tokens || 0, cacheWrite: 0,
    images: (j.data || []).length, imageIn: u.input_tokens_details?.image_tokens || 0 };
  record({ kind: 'image', task: refs.length ? 'image_edit' : 'image', tier: 'image', model: s.imageModel, project: pid, post: postId, usage, ok: true, ms: Date.now() - t0 });

  const dir = path.join(postDir(pid, postId), 'photos'); fs.mkdirSync(dir, { recursive: true });
  const added: Photo[] = [];
  for (const [i, d] of (j.data || []).entries()) {
    if (!d.b64_json) continue;
    const id = uid(8), file = `${id}.png`, f = path.join(dir, file);
    fs.writeFileSync(f, Buffer.from(d.b64_json, 'base64'));
    const info = await probe(f);
    added.push({ id, name: `gpt-image_${r.kind}_${i + 1}.png`, file, ...info, bytes: fs.statSync(f).size, uploadedAt: now(),
      note: r.description.slice(0, 120), source: 'gpt-image', prompt });
  }
  if (!added.length) throw new HttpError(502, 'GPT Image ما رجّع صور');
  await mutate(pid, p => { findPost(p, postId).photos.push(...added); });
  return { photos: added, prompt, usage };
}
