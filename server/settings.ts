// إعدادات قابلة للتعديل من الموقع (data/settings.json) — القيم الافتراضية من .env
import fs from 'node:fs';
import path from 'node:path';
import { DATA, cfg } from './config.js';

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

const F = path.join(DATA, 'settings.json');
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
export function getSettings(): Settings {
  if (cache) return cache;
  const d = defaults();
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(fs.readFileSync(F, 'utf8')); } catch {}
  // المفاتيح بملف .env تغلب الفاضي بالملف
  cache = { ...d, ...saved, models: { ...d.models, ...(saved.models || {}) } } as Settings;
  if (!cache.radoxKey) cache.radoxKey = d.radoxKey;
  if (!cache.anthropicKey) cache.anthropicKey = d.anthropicKey;
  for (const k of ['openaiKey', 'openaiBaseUrl', 'imageProvider']) delete (cache as any)[k];   // خيار OpenAI انحذف
  return cache;
}

export function saveSettings(patch: Partial<Settings>) {
  const cur = getSettings();
  const next: Settings = { ...cur, ...patch, models: { ...cur.models, ...(patch.models || {}) } };
  // المفتاح المقنّع من الواجهة ما يكتب فوق الحقيقي
  for (const k of ['radoxKey', 'anthropicKey'] as const) if (patch[k] && /^•+/.test(patch[k]!)) next[k] = cur[k];
  for (const k of ['openaiKey', 'openaiBaseUrl', 'imageProvider']) delete (next as any)[k];
  fs.writeFileSync(F, JSON.stringify(next, null, 1));
  cache = next;
  return next;
}

const mask = (k: string) => (k ? '••••••••' + k.slice(-4) : '');
export function publicSettings() {
  const s = getSettings();
  return { ...s, radoxKey: mask(s.radoxKey), anthropicKey: mask(s.anthropicKey) };
}
