// مدقق النص العربي — نفس قواعد scripts/lint_ar.py (همزات الوصل، على/إلى، الترقيم، العبارات القانونية الخطرة)
const AR = '؀-ۿ';
const WASL = new RegExp(`(?<![\\w${AR}])(?:و|ف|ب|ل|ال)?إ(ست|خت|عت|نت|جت|نط|فت|قت|لت|مت|حت|نش|نق|نض|نف|نخ|ستث|ط|ز|ص|ض)[\\w${AR}]*`, 'gu');
const WASL_OK = ['إنتاج', 'إنترنت', 'إنتر', 'إنتربول'];
const RULES: [string, string, 'error' | 'warn'][] = [
  [`(?<![${AR}])إسحب`, 'اسحب', 'error'],
  [`(?<![${AR}])علي(?=\\s+(?:ال|[^\\s]*[كهاـ]م?(?![${AR}])|أ|إ|هذ|ذلك|كل|مستوى|حد|سبيل|الأقل|أن|ما))`, 'على', 'error'],
  [`(?<![${AR}])إلي(?=\\s)`, 'إلى', 'error'],
  [`(?<![${AR}])(?:الي)(?=\\s+(?:ال|أ|إ))`, 'إلى', 'warn'],
  [`(?<![${AR}])متي(?![${AR}])`, 'متى', 'error'],
  [`(?<![${AR}])حتي(?![${AR}])`, 'حتى', 'error'],
  [`(?<![${AR}])لدي(?=\\s+(?:ال|الشركة|المستثمر))`, 'لدى', 'warn'],
  [`(?<![${AR}])اذا(?![${AR}])`, 'إذا', 'error'],
  [`(?<![${AR}])ان(?=\\s+(?:ت|ي|ي?كون|تكون))`, 'أن', 'warn'],
  [`لا\\s+تنسي(?![${AR}])`, 'لا تنسَ', 'error'],
  [`إنشاء\\s+الله`, 'إن شاء الله', 'error'],
  [`(?<=[${AR}]) ,|(?<=[${AR}]),`, '،', 'warn'],
  [`(?<=[${AR}])\\s*\\?`, '؟', 'warn'],
  [`(?<=[${AR}]);`, '؛', 'warn'],
  [`[ \\t]{2,}`, 'مسافة واحدة', 'warn'],
  [`\\s+[،.؟!:]`, 'بدون مسافة قبل علامة الترقيم', 'warn'],
];
const RISKY: [RegExp, string][] = [
  [/مضمون|نضمن|ضمان\s+(?:القبول|الموافقة|الإصدار)/g, 'وعد بنتيجة مضمونة — الجهات الحكومية هي صاحبة القرار. استخدم «نساعدك/نجهّز/نتابع»'],
  [/خلال\s+\d+\s*(?:ساعة|ساعات|يوم|أيام)/g, 'مدة محددة — تأكد منها مع العميل أو اكتب «خلال مدة قصيرة»'],
  [/بدون\s+(?:أي\s+)?(?:شروط|متطلبات)/g, 'تعميم خطير — لكل نشاط شروطه'],
  [/(?:رسوم|بسعر|بـ)\s*\d[\d,.]*\s*(?:ريال|ر\.س)/g, 'سعر/رسوم — أكّدها مع العميل ومع المصدر الرسمي قبل النشر'],
];
const SKIP = new Set(['src', 'url', 'theme', 'type', 'icon', 'area', 'pos', 'kind', 'view', 'at', 'logo_variant', 'style', 'heading_style',
  'treat', 'side', 'align', 'v', 'name', 'out_dir', 'format', 'font', 'motif', 'contact_icon', 'contact_align', 'fade_dir', 'blend',
  'scrim', 'scrim_css', 'focus', 'soft', 'stats_style', 'preset', 'mask', 'base', 'bg', 'z', 'shape', 'layout', 'logo_pos', 'pager_style',
  'box_style', 'topline_style', 'tag_style', 'kashida', 'fit', 'photo_fit', 'tone', 'pad', 'box_pad', 'd', 'color', 'ink']);

export type LintIssue = { level: 'error' | 'warn' | 'info'; slide: number; msg: string };

function* walk(o: any, p = ''): Generator<[string, string]> {
  if (typeof o === 'string') yield [p, o];
  else if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) yield* walk(o[i], `${p}[${i}]`); }
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_') || SKIP.has(k) || k.endsWith('_css') || k.endsWith('color')) continue;
      yield* walk(v, p ? `${p}.${k}` : k);
    }
  }
}

export function lintText(s: string): { level: LintIssue['level']; msg: string }[] {
  const out: { level: LintIssue['level']; msg: string }[] = [];
  const plain = s.replace(/[*[\]{}~=]|\(\(|\)\)/g, '').replace(/ـ/g, '');
  for (const m of plain.matchAll(WASL)) {
    const w = m[0];
    if (WASL_OK.some(x => w.endsWith(x) || w.includes(x))) continue;
    out.push({ level: 'error', msg: `همزة وصل: «${w}» ← «${w.replace('إ', 'ا')}»` });
  }
  for (const [pat, fix, lvl] of RULES)
    for (const m of plain.matchAll(new RegExp(pat, 'gu'))) out.push({ level: lvl, msg: `«${m[0].trim() || '␠'}» ← ${fix}` });
  for (const [re, msg] of RISKY) for (const m of plain.matchAll(re)) out.push({ level: 'warn', msg: `«${m[0]}»: ${msg}` });
  if (/[A-Za-z]{3,}/.test(plain) && /[؀-ۿ]/.test(plain) && !/ISO|INVESTOR|GATE|Vision|App|Google|iOS|ZATCA|VAT|LLC/.test(plain))
    out.push({ level: 'info', msg: 'خلط إنجليزي داخل نص عربي — تأكد إنه مقصود' });
  return out;
}

export function lintSpec(spec: any): LintIssue[] {
  const res: LintIssue[] = [];
  const slides = spec.slides || [spec];
  slides.forEach((sl: any, i: number) => {
    for (const [p, s] of walk(sl)) for (const r of lintText(s)) res.push({ level: r.level, slide: i + 1, msg: `${p}: ${r.msg}` });
  });
  if (spec.caption) for (const r of lintText(spec.caption)) res.push({ level: r.level, slide: 0, msg: `caption: ${r.msg}` });
  return res;
}

/** تحذيرات من قائمة المرفوض (نفس build.py) */
export function tasteWarnings(spec: any): string[] {
  const w: string[] = [];
  for (const sl of spec.slides || []) {
    if (sl.footbar) w.push('footbar (الشريط السفلي) رفضه المستخدم — استخدم phone_line');
    if (sl.profile?.frame === true) w.push('إطار الزوايا رفضه المستخدم');
  }
  for (const e of spec.span || []) if (e.kind === 'path') w.push('الخط الذهبي السفلي (span path) رفضه المستخدم — استخدم floor:true');
  return w;
}
