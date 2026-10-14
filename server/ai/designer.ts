// «المصمم»: نفس سير عمل المهارة — فكرة → spec → رسم → فحص آلي → إصلاح → فحص بصري → نسخة جديدة.
// كل خطوة تختار موديلها عبر router.ts (توفير التوكن)، والتعديلات ترجع كـ patch صغير بدل spec كامل.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chat, extractJSON, AIError, type Msg, type Part } from './provider.js';
import { route, canEscalate, classifyFeedback, listModels, type Task, type Route } from './router.js';
import { record } from '../usage.js';
import { systemFor } from './knowledge.js';
import { getSettings } from '../settings.js';
import { draftSpec } from '../calendar.js';
import { prepareSpec, clone, deepMerge, fileUrl, LIBRARY } from '../engine.js';
import { renderSlides, scoreOf } from '../render.js';
import { lintSpec, tasteWarnings } from '../lint.js';
import { thumbForAI } from '../photos.js';
import { mutate, getProject, findPost, postDir, uid, now, currentVersion, type Post, type Version, type QcSummary } from '../store.js';

export type Emit = (ev: Record<string, any>) => void;

/* ── استدعاء مع تصعيد تلقائي: أرخص موديل أولاً، ولو فشل (JSON/تحقق) يصعد مستوى ── */
async function call<T>(task: Task, o0: { pid?: string; preset?: string; messages: Msg[]; maxTokens?: number; post?: string; validate: (j: any) => T }, emit: Emit): Promise<{ out: T; route: Route }> {
  let lastErr: any; let o = o0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await route(task, attempt);
    emit({ type: 'route', task, tier: r.tier, model: r.model, reason: r.reason });
    const t0 = Date.now();
    try {
      const vision = (await listModels()).list.find(m => m.id === r.model)?.vision;
      const messages = vision === false ? stripImages(o.messages) : o.messages;
      const res = await chat({ model: r.model, system: systemFor(task, o.preset), messages, maxTokens: o.maxTokens, json: true,
        effort: r.tier === 'pro' ? 'high' : r.tier === 'fast' ? 'low' : 'medium',
        onDelta: n => emit({ type: 'progress', chars: n }) });
      const cost = record({ kind: 'chat', task, tier: r.tier, model: res.model, project: o.pid, post: o.post, usage: res.usage, ok: true, ms: Date.now() - t0 });
      emit({ type: 'usage', task, model: res.model, ...res.usage, cost });
      if (res.finish === 'length' || res.finish === 'max_tokens') throw new AIError('الرد انقطع (طويل جداً)', 500, true);
      return { out: o.validate(extractJSON(res.text)), route: r };
    } catch (e: any) {
      lastErr = e;
      if (e instanceof AIError && e.status === 422 && /صور|image/i.test(e.message)) { o = { ...o, messages: stripImages(o.messages) }; emit({ type: 'log', level: 'warn', text: `${r.model} ما يدعم الصور — أعدت بدونها` }); continue; }
      if (e instanceof AIError && !e.retryable) throw e;   // مفتاح/رصيد/صلاحية — لا فائدة من التكرار
      emit({ type: 'log', level: 'warn', text: `${r.model}: ${e.message}` });
      if (!canEscalate(r) && attempt > 0) break;
    }
  }
  throw lastErr;
}
const stripImages = (ms: Msg[]): Msg[] => ms.map(m => typeof m.content === 'string' ? m : { ...m, content: m.content.filter(p => p.type === 'text') });

/* ── السياق: المنشور + الصور ── */
function postBrief(post: Post): string {
  return [
    `# المنشور #${post.n}: ${post.title}`,
    `- النوع: ${post.ctype || post.kind} · المنصة: ${post.platform || '—'} · المحور: ${post.pillar || '—'} · النشر: ${post.publish || '—'}`,
    `- الخدمة المكتشفة: ${post.service} → theme: ${post.theme}`,
    `## المحتوى للتصميم (حرفي — لا تغيّر كلماته)\n${post.design || post.title}`,
    `## الكابشن\n${post.caption || '—'}`,
    `## ملاحظات المصمم (إلزامية)\n${post.notes || '—'}`,
  ].join('\n');
}

const LIB_TEXT = '## مكتبة الصور المشتركة (متاحة دائماً — استخدم src كما هو؛ لا تستخدم أي مسار غير الصور المرفوعة وهذه)\n' +
  Object.entries(LIBRARY).map(([k, d]) => `- src:"lib:${k}" · ${d}`).join('\n');

async function photoParts(pid: string, post: Post, max = 8): Promise<Part[]> {
  if (!post.photos.length) return [{ type: 'text', text: '## الصور المرفوعة\nلا يوجد — صمّم بدون أصل (عناصر مرسومة/سهم الهوية/جداول/مكتبة الصور) واكتب photo_requests.\n\n' + LIB_TEXT }];
  const parts: Part[] = [{ type: 'text', text: '## الصور المرفوعة (استخدم src كما هو)\n' + post.photos.map(p =>
    `- src:"${p.id}" · ${p.name} · ${p.w}×${p.h} · ${p.alpha ? 'PNG شفاف (أصل مقصوص جاهز)' : 'صورة كاملة بخلفية'}${p.source === 'gpt-image' ? ' · مولّد بـ GPT Image (اختاره المستخدم — استخدمه عادي)' : ''}${p.note ? ' · ملاحظة: ' + p.note : ''}`).join('\n') }];
  for (const p of post.photos.slice(0, max)) {
    try { const t = await thumbForAI(path.join(postDir(pid, post.id), 'photos', p.file), 512); parts.push({ type: 'text', text: `صورة src:"${p.id}"` }, { type: 'image', ...t }); } catch {}
  }
  parts.push({ type: 'text', text: LIB_TEXT });
  return parts;
}

const validateSpec = (j: any) => {
  const spec = j.spec || j;
  if (!spec || !Array.isArray(spec.slides) || !spec.slides.length) throw new Error('spec بدون شرائح');
  for (const s of spec.slides) if (!s || typeof s !== 'object' || !s.type) throw new Error('شريحة بدون type');
  return { concept: String(j.concept || ''), notes: arr(j.notes), photo_requests: arr(j.photo_requests), spec };
};
const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

const validateOps = (j: any) => {
  if (j.spec) return { summary: String(j.summary || ''), spec: validateSpec(j).spec, ops: [] as Op[] };
  if (!Array.isArray(j.ops)) throw new Error('الرد بدون ops');
  return { summary: String(j.summary || ''), ops: j.ops as Op[], spec: null as any };
};

/* ── patch: تعديلات صغيرة على spec بدون إعادة كتابته (توفير توكن الإخراج) ── */
export interface Op { op: 'set' | 'remove' | 'merge' | 'insert'; path: string; value?: any }
const parsePath = (p: string) => p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).map(k => (/^\d+$/.test(k) ? Number(k) : k));
export function applyOps(spec0: any, ops: Op[]): any {
  const spec = clone(spec0);
  for (const o of ops) {
    const keys = parsePath(o.path || ''); if (!keys.length) { if (o.op === 'merge') Object.assign(spec, o.value); continue; }
    let cur = spec;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = typeof keys[i + 1] === 'number' ? [] : {};
      cur = cur[keys[i]];
    }
    const last = keys[keys.length - 1];
    if (o.op === 'remove') { Array.isArray(cur) && typeof last === 'number' ? cur.splice(last, 1) : delete cur[last]; }
    else if (o.op === 'insert' && Array.isArray(cur) && typeof last === 'number') cur.splice(last, 0, o.value);
    else if (o.op === 'merge') cur[last] = deepMerge(cur[last] || {}, o.value);
    else cur[last] = o.value;
  }
  return spec;
}

const CONTRACT_DESIGN = `## المطلوب
1) افهم المحتوى: الألم/الوعد/الإجراء → عاطفة واحدة + استعارة واحدة (المنهج الإبداعي).
2) اختر preset المناسب لنوع المنشور، واللون حسب الخدمة، ووزّع النص الحرفي على الشرائح.
3) استخدم الصور المرفوعة بأفضل مكان (أصل بطل، مشهد كامل، خلفية المملكة…) — كل أصل مرة وحدة.
أرجع JSON بهذا الشكل بالضبط:
{"concept":"سطرين: الفكرة والعاطفة والاستعارة","notes":["قرارات التصميم والتصحيحات الإملائية"],"photo_requests":["لقطة حقيقية مطلوبة لو ناقص شي"],"spec":{"name":"…","preset":"…","theme":"…","caption":"…","hashtags":["#…"],"slides":[{…}]}}`;

const CONTRACT_PATCH = `أرجع JSON فقط:
{"summary":"وش عدّلت بسطر","ops":[{"op":"set","path":"slides[0].title_fs","value":72},{"op":"merge","path":"slides[1].photo","value":{"h":0.55}},{"op":"remove","path":"slides[2].glass_tag"},{"op":"insert","path":"slides[3]","value":{…}}]}
- path يبدأ من جذر spec (مثل slides[1].photo.h أو theme). غيّر **فقط** المطلوب — لا تعيد كتابة الباقي.`;

/* ── رسم معاينة + الفحص (المحرك + الإملاء + الذوق) ── */
export async function previewAndQC(pid: string, post: Post, spec: any, saveTo?: string) {
  const { spec: prepared, warnings } = await prepareSpec(pid, post, spec);
  const r = await renderSlides(prepared, { scale: 1, jpeg: true });
  const sc = scoreOf(r.map(x => x.qc));
  const lint = lintSpec(spec);
  const lintMsgs = lint.filter(l => l.level !== 'info').map(l => `${l.level === 'error' ? '❌' : '⚠'} #${l.slide} ${l.msg}`);
  const qc: QcSummary = {
    score: Math.max(0, sc.score - 10 * lint.filter(l => l.level === 'error').length),
    errors: sc.errors, warnings: [...sc.warnings, ...warnings, ...tasteWarnings(spec)], lint: lintMsgs,
  };
  const files: string[] = [];
  if (saveTo) {
    fs.mkdirSync(saveTo, { recursive: true });
    for (const x of r) { const f = path.join(saveTo, `${String(x.qc.slide).padStart(2, '0')}.jpg`); fs.writeFileSync(f, x.png); files.push(fileUrl(f)); }
  }
  return { qc, images: r.map(x => x.png), files };
}

const hasProblems = (qc: QcSummary) => qc.errors.length > 0 || qc.lint.some(l => l.startsWith('❌'));

async function fixLoop(pid: string, post: Post, spec: any, emit: Emit, rounds: number, dir: string) {
  let pv = await previewAndQC(pid, post, spec, dir);
  emit({ type: 'qc', ...pv.qc, files: pv.files });
  const s = getSettings();
  for (let i = 0; i < rounds && s.autoFix && hasProblems(pv.qc); i++) {
    emit({ type: 'step', text: `إصلاح أخطاء الفحص (${pv.qc.errors.length + pv.qc.lint.filter(l => l.startsWith('❌')).length})` });
    const { out } = await call('fix', { pid, post: post.id, maxTokens: 12000, validate: validateOps, messages: [{ role: 'user', content:
      `## spec الحالي\n${JSON.stringify(spec)}\n\n## أخطاء الفحص الآلي (لازم تختفي)\n${[...pv.qc.errors, ...pv.qc.lint].join('\n')}\n\n` +
      `أصلحها بأقل تغيير: «النص أكبر من المساحة» → صغّر title_fs/fs أو text_h أكبر · «نص يركب على الأصل» → صغّر photo.h أو كبّر text_h · ` +
      `«تلامس نصوص» → gap/مسافات · تباين → theme_override أو مكان النص · إملاء → صحّح الكلمة فقط (النص حرفي غير ذلك).\n${CONTRACT_PATCH}` }] }, emit);
    spec = out.spec || applyOps(spec, out.ops);
    pv = await previewAndQC(pid, post, spec, dir);
    emit({ type: 'qc', ...pv.qc, files: pv.files });
  }
  return { spec, pv };
}

async function reviewLoop(pid: string, post: Post, spec: any, pv: Awaited<ReturnType<typeof previewAndQC>>, emit: Emit, dir: string, notes: string[]) {
  const rounds = getSettings().reviewRounds;
  for (let i = 0; i < rounds; i++) {
    emit({ type: 'step', text: 'فحص بصري للتصميم المرسوم' });
    const imgs: Part[] = [];
    for (let k = 0; k < pv.images.length; k++) {
      const b = await sharp(pv.images[k]).resize({ width: 540 }).jpeg({ quality: 80 }).toBuffer();
      imgs.push({ type: 'text', text: `الشريحة ${k + 1}` }, { type: 'image', data: b.toString('base64'), media: 'image/jpeg' });
    }
    const { out } = await call('review', { pid, post: post.id, maxTokens: 10000, messages: [{ role: 'user', content: [
      { type: 'text', text: `${postBrief(post)}\n\n## spec\n${JSON.stringify(spec)}\n\n## نتيجة الفحص الآلي\nالدرجة ${pv.qc.score} · ${[...pv.qc.errors, ...pv.qc.warnings].join(' | ') || 'سليم'}` },
      ...imgs,
      { type: 'text', text: `افحص كل شريحة بعين مدير فني: نص يلمس أصل/شعار، كلمة يتيمة، فراغ ميت كبير، أصل صغير أو يتكرر، أصل لا يطابق نصه (flip)، زخرفة فوق النص، ` +
        `عنوان ضخم أو صغير، أي شي من المرفوض بسجل الذوق، أي نص غير موجود حرفياً بالمحتوى. ` +
        `لو كله ممتاز أرجع {"ok":true,"issues":[],"ops":[]}. وإلا أرجع {"ok":false,"issues":["…"],"ops":[…]} بنفس صيغة ops:\n${CONTRACT_PATCH}` },
    ] }], validate: (j: any) => ({ ok: !!j.ok, issues: arr(j.issues), ops: (Array.isArray(j.ops) ? j.ops : []) as Op[] }) }, emit);
    emit({ type: 'review', ok: out.ok, issues: out.issues });
    if (out.ok || !out.ops.length) break;
    notes.push(...out.issues.map(x => 'مراجعة: ' + x));
    const next = applyOps(spec, out.ops);
    const pv2 = await previewAndQC(pid, post, next, dir);
    if (pv2.qc.errors.length > pv.qc.errors.length) { emit({ type: 'log', level: 'warn', text: 'تعديل المراجعة زاد الأخطاء — رجعت للنسخة قبله' }); break; }
    spec = next; pv = pv2;
    emit({ type: 'qc', ...pv.qc, files: pv.files });
  }
  return { spec, pv };
}

async function saveVersion(pid: string, postId: string, v: Omit<Version, 'id' | 'n' | 'createdAt'>, id = uid()): Promise<Version> {
  return mutate(pid, p => {
    const post = findPost(p, postId);
    const ver: Version = { id, n: post.versions.length + 1, createdAt: now(), ...v };
    post.versions.push(ver); post.current = ver.id; post.state = 'review'; post.updatedAt = now();
    return ver;
  });
}

function normalize(spec: any, post: Post, base?: any) {
  const d = base || draftSpec(post);
  spec.name ||= d.name; spec.caption ??= d.caption; spec.hashtags ??= d.hashtags;
  if (!spec.preset && !spec.format) spec.format = 'post';
  return spec;
}

/* ═════════ تصميم جديد ═════════ */
export async function designPost(pid: string, postId: string, emit: Emit, opts: { direction?: string } = {}) {
  const post = findPost(getProject(pid), postId);
  emit({ type: 'step', text: 'قراءة المحتوى والصور' });
  const draft = draftSpec(post);
  const content: Part[] = [
    { type: 'text', text: postBrief(post) },
    ...(await photoParts(pid, post)),
    { type: 'text', text: `## مسودة آلية من التقويم (تقسيم الشرائح فقط — طوّرها)\n${JSON.stringify(draft)}\n\n${opts.direction ? `## توجيه المستخدم\n${opts.direction}\n\n` : ''}${CONTRACT_DESIGN}` },
  ];
  emit({ type: 'step', text: 'الفكرة وكتابة التصميم' });
  const { out, route: r } = await call('design', { pid, preset: draft.preset, post: postId, maxTokens: 40000, validate: validateSpec, messages: [{ role: 'user', content }] }, emit);
  return finish(pid, post, normalize(out.spec, post, draft), { concept: out.concept, notes: [...out.notes, ...out.photo_requests.map(x => '📷 مطلوب: ' + x)], source: 'ai', label: r.model }, emit);
}

async function finish(pid: string, post: Post, spec: any, meta: { concept?: string; notes: string[]; source: Version['source']; label?: string; feedback?: string }, emit: Emit, fixRounds = 2) {
  const vid = uid(); const dir = path.join(postDir(pid, post.id), 'renders', vid);
  emit({ type: 'step', text: 'رسم المعاينة والفحص الآلي' });
  let { spec: s1, pv } = await fixLoop(pid, post, spec, emit, fixRounds, dir);
  if (meta.source !== 'manual') ({ spec: s1, pv } = await reviewLoop(pid, post, s1, pv, emit, dir, meta.notes));
  const ver = await saveVersion(pid, post.id, { source: meta.source, label: meta.label, concept: meta.concept, notes: meta.notes, feedback: meta.feedback,
    spec: s1, qc: pv.qc, preview: pv.files[0] }, vid);
  emit({ type: 'version', version: ver, files: pv.files });
  return ver;
}

/* ═════════ تعديل بملاحظة ═════════ */
export async function revisePost(pid: string, postId: string, feedback: string, emit: Emit, versionId?: string) {
  const post = findPost(getProject(pid), postId);
  const base = (versionId && post.versions.find(v => v.id === versionId)) || currentVersion(post);
  if (!base) return designPost(pid, postId, emit, { direction: feedback });
  const task = classifyFeedback(feedback);
  emit({ type: 'step', text: task === 'revise_major' ? 'تعديل كبير — إعادة الفكرة' : task === 'revise_minor' ? 'تعديل صغير' : 'تعديل' });
  await mutate(pid, p => { findPost(p, postId).chat.push({ id: uid(), role: 'user', text: feedback, at: now(), version: base.id }); });
  const history = post.chat.slice(-6).map(m => `${m.role === 'user' ? 'المستخدم' : 'المصمم'}: ${m.text}`).join('\n');
  let spec: any, summary = '';
  if (task === 'revise_major') {
    const content: Part[] = [{ type: 'text', text: postBrief(post) }, ...(await photoParts(pid, post)),
      { type: 'text', text: `## النسخة الحالية\n${JSON.stringify(base.spec)}\n\n## سجل المحادثة\n${history || '—'}\n\n## ملاحظة المستخدم (طبّقها بدقة)\n${feedback}\n\n${CONTRACT_DESIGN}` }];
    const { out } = await call('revise_major', { pid, preset: base.spec.preset, post: postId, maxTokens: 40000, validate: validateSpec, messages: [{ role: 'user', content }] }, emit);
    spec = normalize(out.spec, post, base.spec); summary = out.concept;
  } else {
    const { out } = await call(task, { pid, post: postId, maxTokens: task === 'revise_minor' ? 8000 : 14000, validate: validateOps, messages: [{ role: 'user', content:
      `## المحتوى الحرفي (مرجع)\n${post.design}\n\n## spec الحالي\n${JSON.stringify(base.spec)}\n\n## سجل المحادثة\n${history || '—'}\n\n## ملاحظة المستخدم\n${feedback}\n\n${CONTRACT_PATCH}` }] }, emit);
    spec = out.spec || applyOps(base.spec, out.ops); summary = out.summary;
  }
  await mutate(pid, p => { findPost(p, postId).chat.push({ id: uid(), role: 'assistant', text: summary || 'تم التعديل', at: now() }); });
  return finish(pid, findPost(getProject(pid), postId), spec, { notes: summary ? [summary] : [], source: 'ai', feedback }, emit, task === 'revise_minor' ? 1 : 2);
}

/* ═════════ خيارات بديلة (المستخدم يحب يقارن جنب بعض) ═════════ */
const DIRECTIONS = [
  'اتجاه بديل: نفس المحتوى بتخطيط مختلف تماماً (preset آخر مناسب أو توزيع مختلف للأصل والنص)، مع الالتزام بلون الخدمة.',
  'اتجاه بديل تحريري: خط ثمانية سيرف (font:"thmanyah")، محاذاة أهدأ، مساحات أوسع، وعنصر بطل واحد كبير.',
  'اتجاه بديل داكن فخم: خلفية فحمي الموقع #26272A أو graphite مع ذهب الهوية، والأصل نفسه بدون تأثيرات.',
];
export async function variantsPost(pid: string, postId: string, count: number, emit: Emit) {
  const post = findPost(getProject(pid), postId);
  const base = currentVersion(post);
  const draft = draftSpec(post);
  const photos = await photoParts(pid, post, 6);
  const jobs = DIRECTIONS.slice(0, Math.max(1, Math.min(3, count))).map(async (dir, i) => {
    const sub: Emit = ev => emit({ ...ev, variant: i + 1 });
    const content: Part[] = [{ type: 'text', text: postBrief(post) }, ...photos,
      { type: 'text', text: `${base ? `## النسخة الحالية (لا تكررها — اعمل بديل)\n${JSON.stringify(base.spec)}\n\n` : `## مسودة آلية\n${JSON.stringify(draft)}\n\n`}## ${dir}\n\n${CONTRACT_DESIGN}` }];
    const { out, route: r } = await call('variant', { pid, preset: draft.preset, post: postId, maxTokens: 32000, validate: validateSpec, messages: [{ role: 'user', content }] }, sub);
    return finish(pid, findPost(getProject(pid), postId), normalize(out.spec, post, draft), { concept: out.concept, notes: out.notes, source: 'variant', label: `خيار ${i + 1} · ${r.model}` }, sub, 1);
  });
  const res = await Promise.allSettled(jobs);
  return res.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<Version>).value);
}

/* ═════════ الكابشن (أرخص موديل) ═════════ */
export async function polishCaption(pid: string, postId: string, emit: Emit) {
  const post = findPost(getProject(pid), postId);
  const { out } = await call('caption', { pid, post: postId, maxTokens: 6000, validate: (j: any) => ({ caption: String(j.caption || ''), hashtags: arr(j.hashtags), fixes: arr(j.fixes) }), messages: [{ role: 'user', content:
    `صحّح الكابشن إملائياً فقط (همزات الوصل، على/إلى، الترقيم العربي) — بدون تغيير الصياغة أو إضافة جمل. افصل الهاشتاقات.\n` +
    `## الكابشن\n${post.caption}\n\nأرجع {"caption":"…","hashtags":["#…"],"fixes":["«قبل» ← «بعد»"]}` }] }, emit);
  return out;
}

/* ═════════ تعديل يدوي (JSON) — بدون ذكاء اصطناعي ═════════ */
export async function manualVersion(pid: string, postId: string, spec: any, emit: Emit, label?: string) {
  const post = findPost(getProject(pid), postId);
  return finish(pid, post, spec, { notes: [], source: 'manual', label: label || 'تعديل يدوي' }, emit, 0);
}
