// التوجيه الذكي بين الموديلات — كل طلب يروح لأرخص موديل يقدر يسويه صح، ويصعد لمستوى أقوى فقط لو فشل.
//   pro       → تصميم جديد من المحتوى، أو إعادة فكرة كاملة (يحتاج إبداع + فهم كل القواعد)
//   balanced  → خيارات بديلة، تعديلات متوسطة، إصلاح أخطاء الفحص، تحليل التقويم
//   fast      → تعديلات صغيرة (حجم/لون/مكان/نص) كـ patch، الكابشن والإملاء
//   vision    → الفحص البصري للتصميم المرسوم (يشوف الصورة)
import { getSettings, type Tier } from '../settings.js';
import { setCatalogPricing } from '../usage.js';

export type Task = 'design' | 'variant' | 'revise_minor' | 'revise_major' | 'revise' | 'fix' | 'review' | 'caption' | 'plan';

export interface ModelInfo { id: string; name?: string; vision: boolean; reasoning: boolean; context?: number; inPer1k?: number; outPer1k?: number }

/* ── قائمة الموديلات من المنصة (GET /v1/models) — كاش 10 دقائق ── */
let catalog: { at: number; list: ModelInfo[]; error?: string } = { at: 0, list: [] };

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', vision: true, reasoning: true, inPer1k: 0.004, outPer1k: 0.02 },
  { id: 'claude-sonnet-5-5', vision: true, reasoning: true, inPer1k: 0.002, outPer1k: 0.01 },
  { id: 'claude-haiku-5-5', vision: true, reasoning: true, inPer1k: 0.0001, outPer1k: 0.0005 },
];

const VISION_NAMES = /claude|gpt-(4o|4\.1|5)|gemini|grok-4|kimi-k3|qwen.*(vl|max)|seed-2/i;
function num(v: any): number | undefined { const n = Number(v); return isFinite(n) && v !== null && v !== '' ? n : undefined; }

function parseModel(m: any): ModelInfo {
  const caps = m.capabilities;
  const has = (k: string) => Array.isArray(caps) ? caps.some((c: any) => String(c).toLowerCase().includes(k)) : !!(caps && (caps[k] || caps[k + '_input']));
  const p = m.pricing || {};
  const pick = (re: RegExp) => { for (const [k, v] of Object.entries(p)) if (re.test(k)) return num(v); };
  // RadoxAI قد لا يرجّع capabilities — نستنتج دعم الصور من اسم الموديل (العائلات المعروفة بالرؤية)
  const vision = caps ? (has('vision') || has('image')) : VISION_NAMES.test(m.id);
  return { id: m.id, name: m.name || m.display_name, context: num(m.context_window), vision,
    reasoning: caps ? has('reason') : true, inPer1k: pick(/prompt|input/i), outPer1k: pick(/completion|output/i) };
}

export async function listModels(force = false): Promise<{ list: ModelInfo[]; error?: string }> {
  const s = getSettings();
  if (s.provider === 'anthropic') return { list: ANTHROPIC_MODELS };
  if (!force && Date.now() - catalog.at < 10 * 60e3 && catalog.list.length) return catalog;
  if (!s.radoxKey) return { list: [], error: 'مفتاح RadoxAI غير مضبوط' };
  try {
    const r = await fetch(s.radoxBaseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: `Bearer ${s.radoxKey}` } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    catalog = { at: Date.now(), list: (j.data || j.models || []).map(parseModel) };
  } catch (e: any) { catalog = { at: Date.now() - 9 * 60e3, list: catalog.list, error: e.message }; }
  return catalog;
}

/* ── اختيار تلقائي لكل مستوى حسب أسماء الموديلات (الأحدث إصداراً أولاً) ── */
const PREFS: Record<Tier, RegExp[]> = {
  pro: [/claude.*opus/i, /gpt-5(?!.*(mini|nano))/i, /gemini.*pro/i, /claude.*sonnet/i],
  balanced: [/claude.*sonnet/i, /gemini.*(2\.5|3).*flash(?!.*lite)/i, /gpt-5.*mini/i, /gpt-4\.1(?!.*(mini|nano))/i, /deepseek.*(chat|v3)/i],
  fast: [/claude.*haiku/i, /gemini.*flash.*lite/i, /gemini.*flash/i, /gpt-5.*nano/i, /gpt-4\.1.*mini|gpt-4o-mini/i, /deepseek.*chat/i],
  vision: [/claude.*sonnet/i, /gemini.*flash(?!.*lite)/i, /gpt-5.*mini/i, /claude.*opus/i],
};
const ver = (id: string) => (id.match(/\d+(?:[.-]\d+)?/g) || []).map(x => parseFloat(x.replace('-', '.'))).reduce((a, b) => Math.max(a, b), 0);

export async function resolveTier(tier: Tier): Promise<string> {
  const s = getSettings();
  if (s.models[tier]) return s.models[tier];
  const { list } = await listModels();
  const pool = tier === 'vision' ? list.filter(m => m.vision) : list;
  for (const re of PREFS[tier]) {
    const hits = pool.filter(m => re.test(m.id) && !/embed|whisper|tts|image-gen|dall/i.test(m.id)).sort((a, b) => ver(b.id) - ver(a.id));
    if (hits.length) return hits[0].id;
  }
  if (tier !== 'pro') return resolveTier(tier === 'vision' ? 'pro' : tier === 'fast' ? 'balanced' : 'pro');
  if (pool[0]) return pool[0].id;
  return s.provider === 'anthropic' ? 'claude-opus-5-5' : 'claude-opus-4.8';
}

/* ── تصنيف ملاحظة المستخدم: صغيرة/متوسطة/كبيرة — بدون استدعاء موديل (توفير) ── */
const MAJOR = /(فكرة|كونسبت|concept|من جديد|من الصفر|غير(?:ّ)? (?:التصميم|الفكرة|الأسلوب|الستايل)|أسلوب ثاني|ستايل|تخطيط جديد|اعد التصميم|أعد التصميم|ما عجبني|مو حلو|سيء|خيار(?:ات)? (?:ثاني|جديد)|كله|كاملاً|بالكامل|شريحة جديدة|أضف شريحة|احذف شريحة)/i;
const MINOR = /(كبّ?ر|صغّ?ر|حرّ?ك|ارفع|نزّ?ل|انقل|يمين|يسار|فوق|تحت|لون|غامق|فاتح|شفاف|حجم|خط|سطر|مسافة|هامش|عدّ?ل النص|غيّ?ر (?:كلمة|النص|الرقم)|املاء|إملاء|اقلب|flip|شعار|الرقم|تكستشر|ظل|أنحف|أعرض|عريض)/i;

export function classifyFeedback(text: string): 'revise_minor' | 'revise' | 'revise_major' {
  const t = text.trim();
  if (MAJOR.test(t)) return 'revise_major';
  const asks = t.split(/[\n،,.؛]+| و(?=\S)/).filter(x => x.trim().length > 2).length;
  if (MINOR.test(t) && asks <= 3 && t.length < 240) return 'revise_minor';
  return 'revise';
}

const TASK_TIER: Record<Task, Tier> = {
  design: 'pro', revise_major: 'pro',
  variant: 'balanced', revise: 'balanced', fix: 'balanced', plan: 'balanced',
  revise_minor: 'fast', caption: 'fast',
  review: 'vision',
};
const UP: Record<Tier, Tier | null> = { fast: 'balanced', balanced: 'pro', vision: 'pro', pro: null };

export interface Route { task: Task; tier: Tier; model: string; reason: string }

export async function route(task: Task, attempt = 0): Promise<Route> {
  const s = getSettings();
  let tier: Tier = TASK_TIER[task];
  if (s.routing === 'quality') tier = task === 'review' ? 'vision' : 'pro';
  if (s.routing === 'economy' && tier !== 'vision') tier = attempt ? tier : (tier === 'pro' ? 'balanced' : 'fast');
  for (let i = 0; i < attempt && UP[tier]; i++) tier = UP[tier]!;
  const model = await resolveTier(tier);
  const reason = attempt ? `تصعيد بعد محاولة فاشلة → ${tier}` : `${task} → ${tier}${s.routing !== 'smart' ? ` (${s.routing})` : ''}`;
  return { task, tier, model, reason };
}

export const canEscalate = (r: Route) => !!UP[r.tier] && getSettings().routing !== 'quality';

/* ── أسعار المنصة (لو موجودة) لحساب التكلفة — الإعدادات تغلبها ── */
setCatalogPricing(model => {
  const m = catalog.list.find(x => x.id === model) || ANTHROPIC_MODELS.find(x => x.id === model);
  return m && m.inPer1k !== undefined ? { in: (m.inPer1k || 0) * 1000, out: (m.outPer1k || 0) * 1000 } : undefined;
});
