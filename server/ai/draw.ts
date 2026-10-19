// عناصر مرسومة بالكود بـ Claude (عبر RadoxAI) — «نولّد الأشياء ونصوّر الناس»:
// Claude يكتب العنصر HTML/SVG بأسلوب الهوية ← كروم يرسمه PNG شفاف 3× ← (اختياري) فحص بصري وتصحيح ← يُحفظ كأصل للمنشور مع الكود
// عشان التعديلات بالكلام تعدّل نفس العنصر.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chat, extractJSON, type Part } from './provider.js';
import { resolveTier } from './router.js';
import { record } from '../usage.js';
import { renderElementHTML } from '../render.js';
import { ENGINE } from '../config.js';
import { probe } from '../photos.js';
import { persist, ensureLocal } from '../storage.js';
import { mutate, findPost, getProject, postDir, uid, now, HttpError, type Photo } from '../store.js';

const GUIDE = () => fs.readFileSync(path.join(ENGINE, 'knowledge', 'drawn-elements.md'), 'utf8');

const SYS = () => `You are a senior illustrator who draws premium, tactile OBJECTS in code (HTML + CSS + inline SVG, optional small <script> for geometry)
for "Investor Gate" (بوابة المستثمر) social designs. The result is rendered by headless Chrome on a TRANSPARENT background and placed into a post.
${GUIDE()}

Technical rules:
- Output ONE self-contained fragment that fills a box of exactly w×h px (position everything inside it; nothing outside). Leave ~6% margin around the object for its shadow.
- Allowed: <style> (scope classes with a unique prefix), inline <svg> with gradients/filters/masks, CSS gradients/shadows/masks/clip-path, a short <script> that only builds SVG/DOM (no network, no timers > 0, no external URLs).
- Assets you MAY reference by relative URL: engine/assets/textures/{paper,cotton,stucco,grain}.png (for subtle material), engine/assets/logo/symbol_color.svg (brand symbol, only if it belongs on the object, e.g. a compass hub or a stamp).
- Fonts available: 'Expo', 'ThSerif', 'ThSans', 'Plex' — but avoid text unless the request explicitly needs it.
- Body background must stay transparent. No people, hands or faces.
Return JSON only: {"w":<int 300-1400>,"h":<int 300-1400>,"html":"<fragment>","notes":"one Arabic line: what you drew"}`;

async function claudeModel(pro: boolean) {
  // نفضّل Claude للرسم بالكود (تفصيل دقيق وواعي بالمواد)
  return resolveTier(pro ? 'pro' : 'balanced');
}

async function callDraw(task: string, pro: boolean, content: Part[] | string, pid?: string, postId?: string) {
  const model = await claudeModel(pro);
  const t0 = Date.now();
  const res = await chat({ model, system: [SYS()], messages: [{ role: 'user', content }], json: true, maxTokens: 24000, effort: pro ? 'high' : 'medium' });
  record({ kind: 'chat', task, tier: pro ? 'pro' : 'balanced', model: res.model, project: pid, post: postId, usage: res.usage, ok: true, ms: Date.now() - t0 });
  const j = extractJSON(res.text);
  if (!j?.html || typeof j.html !== 'string') throw new Error('الرد ما فيه html');
  const clamp = (v: any, d: number) => Math.max(300, Math.min(1400, Math.round(Number(v) || d)));
  return { w: clamp(j.w, 900), h: clamp(j.h, 900), html: j.html as string, notes: String(j.notes || ''), model: res.model };
}

/** يقص الحواف الشفافة الزايدة (مع هامش للظل) */
async function trimAlpha(png: Buffer) {
  try { return await sharp(png).trim({ threshold: 1 }).png().toBuffer(); } catch { return png; }
}

export interface DrawOpts { description: string; w?: number; h?: number; review?: boolean; pro?: boolean; emit?: (ev: any) => void; context?: string }

/** يرسم عنصر جديد ويضيفه لصور المنشور */
export async function drawElement(pid: string, postId: string, o: DrawOpts): Promise<Photo> {
  findPost(getProject(pid), postId);
  const emit = o.emit || (() => {});
  emit({ type: 'step', text: `Claude يرسم بالكود: ${o.description.slice(0, 70)}` });
  let d = await callDraw('draw', o.pro !== false, `الوصف (بالعربي):\n${o.description}\n${o.context ? `\nسياق التصميم: ${o.context}\n` : ''}${o.w && o.h ? `\nالمقاس المقترح: ${o.w}×${o.h}` : ''}`, pid, postId);
  let png = await renderElementHTML(d.html, d.w, d.h);
  if (o.review !== false) {   // فحص بصري: Claude يشوف اللي رسمه ويصحح
    emit({ type: 'step', text: 'فحص الرسم بصرياً وتحسينه' });
    const prev = await sharp(png).resize({ width: 640, height: 640, fit: 'inside' }).flatten({ background: '#EDE7DA' }).jpeg({ quality: 82 }).toBuffer();
    try {
      const fix = await callDraw('draw_review', false, [
        { type: 'text', text: `هذا الرسم الحالي (معروض على خلفية عاجية للمعاينة فقط). الوصف: ${o.description}\nالكود الحالي:\n${d.html}` },
        { type: 'image', data: prev.toString('base64'), media: 'image/jpeg' },
        { type: 'text', text: 'قيّمه بعين مدير فني: هل يقرأ كالشي المطلوب؟ هل الإحساس مادي فاخر بدون شكل كرتوني؟ هل فيه عناصر طالعة برا الصندوق أو مقصوصة؟ أصلح المشاكل وأرجع نفس صيغة JSON كاملة (حتى لو بدون تغيير).' },
      ], pid, postId);
      const png2 = await renderElementHTML(fix.html, fix.w, fix.h);
      d = fix; png = png2;
    } catch (e: any) { emit({ type: 'log', level: 'warn', text: `الفحص البصري للرسم تخطّيناه: ${e.message}` }); }
  }
  return saveDrawn(pid, postId, await trimAlpha(png), d, o.description, null);
}

/** تعديل عنصر مرسوم بالكلام — يعدّل نفس الكود ويطلع نسخة جديدة مربوطة */
export async function editDrawn(pid: string, postId: string, ph: Photo, instruction: string, emit: (ev: any) => void = () => {}): Promise<Photo> {
  const htmlKey = ph.asset?.html; if (!htmlKey) throw new HttpError(400, 'هذا الأصل ما له كود رسم');
  const abs = await ensureLocal(path.join(postDir(pid, postId), 'photos', htmlKey));
  if (!abs) throw new HttpError(404, 'كود الرسم مفقود');
  const prev = JSON.parse(fs.readFileSync(abs, 'utf8')) as { w: number; h: number; html: string };
  emit({ type: 'step', text: `Claude يعدّل الرسم: ${instruction.slice(0, 70)}` });
  const d = await callDraw('draw_edit', false, `عدّل هذا العنصر المرسوم حسب الطلب، واحتفظ بكل شي ما طُلب تغييره (الأسلوب، الألوان، التكوين).\nالوصف الأصلي: ${ph.asset?.description || ph.note || ''}\nالطلب (بالعربي): ${instruction}\nالمقاس الحالي: ${prev.w}×${prev.h}\nالكود الحالي:\n${prev.html}`, pid, postId);
  const png = await trimAlpha(await renderElementHTML(d.html, d.w, d.h));
  return saveDrawn(pid, postId, png, d, ph.asset?.description || ph.note || '', ph, instruction);
}

async function saveDrawn(pid: string, postId: string, png: Buffer, d: { w: number; h: number; html: string; notes: string; model: string }, description: string, parent: Photo | null, instruction?: string): Promise<Photo> {
  const dir = path.join(postDir(pid, postId), 'photos'); fs.mkdirSync(dir, { recursive: true });
  const id = uid(8), file = `${id}.png`, codeFile = `${id}.draw.json`;
  fs.writeFileSync(path.join(dir, file), png);
  fs.writeFileSync(path.join(dir, codeFile), JSON.stringify({ w: d.w, h: d.h, html: d.html, model: d.model }));
  await persist(path.join(dir, file)); await persist(path.join(dir, codeFile));
  const info = await probe(path.join(dir, file));
  const rev = (parent?.asset?.rev || 0) + 1;
  const ph: Photo = {
    id, name: `drawn_${(parent?.name || description).replace(/(_r\d+)?\.png$/i, '').replace(/[^\w؀-ۿ]+/g, '_').slice(0, 30)}${rev > 1 ? '_r' + rev : ''}.png`,
    file, ...info, bytes: png.length, uploadedAt: now(), note: (instruction || description).slice(0, 120), source: 'code-drawn',
    asset: { kind: 'element', description, rev, root: parent ? (parent.asset?.root || parent.id) : undefined, parent: parent?.id, html: codeFile,
      history: [...(parent?.asset?.history || [{ at: now(), instruction: description, prompt: d.notes }]), ...(parent ? [{ at: now(), instruction: instruction || '', prompt: d.notes }] : [])] },
  };
  await mutate(pid, p => { findPost(p, postId).photos.push(ph); });
  return ph;
}
