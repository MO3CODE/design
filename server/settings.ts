// إعدادات قابلة للتعديل من الموقع (data/settings.json) — القيم الافتراضية من .env
import { cfg } from './config.js';
import { readJSON, writeJSON, IS_VERCEL } from './storage.js';

export type Tier = 'pro' | 'balanced' | 'fast' | 'vision';
export interface Settings {
  provider: 'radox' | 'anthropic';
  radoxKey: string; radoxBaseUrl: string; anthropicKey: string;
  /** موديل لكل مستوى — فاضي = اختيار تلقائي من قائمة موديلات المنصة */
  models: Record<Tier, string>;
  /** smart: يوزّع حسب نوع الطلب · quality: الأقوى دايماً · economy: الأرخص ويصعد فقط عند الفشل */
  routing: 'smart' | 'quality' | 'economy';
  reviewRounds: number;   // جولات الفحص البصري بعد التصميم
  autoFix: boolean;       // إصلاح أخطاء الفحص الآلي تلقائياً
  monthlyBudget: number;  // تنبيه لو تعدّت التكلفة الشهرية (دولار) — 0 = بدون
  /** أسعار لكل موديل (دولار لكل مليون توكن) — RadoxAI ما ينشر أسعار بالـ API، فتُدخل هنا */
  prices: Record<string, { in?: number; out?: number; cached?: number }>;
  /** توليد الصور والعناصر — GPT Image عبر RadoxAI (نفس المفتاح) */
  imageModel: string; imageQuality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  /** موديل قراءة التصميم وكتابة برومبتات الصور (فاضي = GPT من RadoxAI تلقائياً) */
  assetModel: string;
}

const KEY = 'settings.json';
let saved: Partial<Settings> = {}; let loadedAt = 0;
const defaults = (): Settings => ({
  provider: (process.env.AI_PROVIDER as Settings['provider']) || (process.env.RADOX_API_KEY || !cfg.anthropicKey ? 'radox' : 'anthropic'),
  radoxKey: process.env.RADOX_API_KEY || '',
  radoxBaseUrl: process.env.RADOX_BASE_URL || 'https://radoxai.com/v1',
  anthropicKey: cfg.anthropicKey,
  models: { pro: process.env.MODEL_PRO || '', balanced: process.env.MODEL_BALANCED || '', fast: process.env.MODEL_FAST || '', vision: process.env.MODEL_VISION || '' },
  routing: (process.env.AI_ROUTING as Settings['routing']) || 'smart',
  reviewRounds: cfg.reviewRounds,
  autoFix: process.env.AI_AUTOFIX !== '0',
  monthlyBudget: Number(process.env.AI_MONTHLY_BUDGET || 0),
  prices: {},
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-2.5-flare',
  imageQuality: (process.env.IMAGE_QUALITY as Settings['imageQuality']) || 'high',
  assetModel: process.env.ASSET_MODEL || '',
});

let cache: Settings | null = null;
/** يقرأ الإعدادات المحفوظة (على Vercel من Blob) — يُستدعى أول كل طلب، وكاش قصير */
export async function loadSettings(maxAgeMs = 15000) {
  if (Date.now() - loadedAt < maxAgeMs && cache) return cache;
  saved = (await readJSON<Partial<Settings>>(KEY)) || {};
  loadedAt = Date.now(); cache = null;
  return getSettings();
}
export function getSettings(): Settings {
  if (cache) return cache;
  const d = defaults();
  cache = { ...d, ...saved, models: { ...d.models, ...(saved.models || {}) } } as Settings;
  // المفاتيح: على Vercel من متغيرات البيئة فقط (ما تنحفظ بالتخزين)؛ محلياً .env يغلب الفاضي
  if (IS_VERCEL || !cache.radoxKey) cache.radoxKey = d.radoxKey;
  if (IS_VERCEL || !cache.anthropicKey) cache.anthropicKey = d.anthropicKey;
  for (const k of ['openaiKey', 'openaiBaseUrl', 'imageProvider']) delete (cache as any)[k];   // خيار OpenAI انحذف
  return cache;
}

export async function saveSettings(patch: Partial<Settings>) {
  await loadSettings(0);
  const cur = getSettings();
  const next: Settings = { ...cur, ...patch, models: { ...cur.models, ...(patch.models || {}) } };
  // المفتاح المقنّع من الواجهة ما يكتب فوق الحقيقي
  for (const k of ['radoxKey', 'anthropicKey'] as const) if (patch[k] && /^•+/.test(patch[k]!)) next[k] = cur[k];
  const toSave: any = { ...next };
  for (const k of ['openaiKey', 'openaiBaseUrl', 'imageProvider']) delete toSave[k];
  if (IS_VERCEL) { delete toSave.radoxKey; delete toSave.anthropicKey; }   // الأسرار ما تنكتب بالتخزين على Vercel
  await writeJSON(KEY, toSave);
  saved = toSave; cache = null; loadedAt = Date.now();
  return getSettings();
}

const mask = (k: string) => (k ? '••••••••' + k.slice(-4) : '');
export function publicSettings() {
  const s = getSettings();
  return { ...s, radoxKey: mask(s.radoxKey), anthropicKey: mask(s.anthropicKey) };
}
