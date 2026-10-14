import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE = path.join(ROOT, 'engine');
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });

const num = (v: string | undefined, d: number) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export const cfg = {
  port: num(process.env.PORT, 8787),
  /** عنوان السيرفر كما يراه كروم الداخلي (لرسم الشرائح) */
  selfUrl: process.env.SELF_URL || `http://127.0.0.1:${num(process.env.PORT, 8787)}`,
  appPassword: process.env.APP_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'change-me',

  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
  model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
  effort: (process.env.CLAUDE_EFFORT || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  /** جولات المراجعة البصرية: يرسم المسودة ويرسلها لـ Claude يفحصها بعينه ويصلحها */
  reviewRounds: num(process.env.AI_REVIEW_ROUNDS, 1),
  /** يضيف كود المحرك (slide.html ≈ 40 ألف توكن) لطلبات التصميم الجديد — أدق لكن أغلى بدون كاش */
  includeEngineSource: process.env.AI_INCLUDE_ENGINE_SOURCE === '1',
  serverFallback: process.env.AI_SERVER_FALLBACK !== '0',

  chromePath: process.env.CHROME_PATH || '',
  python: process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
  /** دقة الإخراج النهائي — «جودة الملف مهمة جداً»: 3× = 3240×4050 للمنشور */
  exportScale: num(process.env.EXPORT_SCALE, 3),
  maxPhotoSide: num(process.env.MAX_PHOTO_SIDE, 3400),
  /** مجلد إضافي للخطوط التجارية (Expo Arabic / Bahij) — ما تنرفع للريبو العام */
  fontsDir: process.env.FONTS_DIR ? path.resolve(process.env.FONTS_DIR) : '',
};

export const SIZES: Record<string, [number, number]> = {
  post: [1080, 1350], story: [1080, 1920], tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080],
};
