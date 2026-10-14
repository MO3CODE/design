// تقويم المحتوى (Excel العميل) → منشورات + مسودة spec — نفس منطق scripts/calendar.py بالمهارة
import ExcelJS from 'exceljs';
import { blankPost, type Post } from './store.js';

export const SERVICE: [string[], string, string][] = [   // (كلمات، ثيم، اسم الخدمة) — الأولوية بالترتيب
  [['إقامة مميزة', 'الإقامة المميزة', 'اقامة مميزة'], 'svc_residency', 'الإقامة المميزة'],
  [['علامة تجارية', 'العلامة التجارية', 'علامتك'], 'svc_trademark', 'العلامة التجارية'],
  [['قوائم مالية', 'القوائم المالية', 'محاسب', 'زكاة', 'ضريب', 'مراجع حسابات'], 'svc_accounting', 'المحاسبة والقوائم المالية'],
  [['كيان خارجي', 'الكيان الخارجي', 'شركة دولية', 'الشركة الدولية', 'غير سعودي', 'المستثمر الأجنبي', 'مستثمر أجنبي'], 'svc_investor', 'خدمات المستثمرين'],
  [['تأسيس', 'فرع', 'السجل التجاري', 'سجلك', 'ترخيص', 'تراخيص', 'رخصة', 'رخص'], 'svc_formation', 'تأسيس الشركات'],
];
export const SERVICE_NAMES: Record<string, string> = Object.fromEntries(SERVICE.map(s => [s[1], s[2]]));
SERVICE_NAMES.graphite = 'العلامة الأم';

const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿️‍⬅⬆⬇⤴⤵▶◀]/gu;
const MARK = /(?:^|\s|\|)(?:ا?ل?ا?شريحة|السلايد|سلايد)\s*([0-9٠-٩]+|الأول|الاول|الأخيرة|الاخيرة|الأخير|الاخير)?\s*(?:[|:—\-–]\s*)?/gm;
const BULLET = /^\s*(?:[✅✔️❌⚠️•\-*·]|[0-9٠-٩]+[).]|[0-9]️⃣)\s*/u;

export const clean = (t: string) => (t || '').replace(EMOJI, '').replace(/[ \t]+/g, ' ').trim().replace(/^[ |]+|[ |]+$/g, '');

export function detectService(title: string, design: string, caption: string): { theme: string; service: string } {
  const score = (keys: string[]) => keys.reduce((s, k) => s + 4 * count(title, k) + count(design, k) + 0.5 * count(caption, k), 0);
  let best = SERVICE[0], bs = -1;
  for (const s of SERVICE) { const v = score(s[0]); if (v > bs) { bs = v; best = s; } }
  return bs >= 1 ? { theme: best[1], service: best[2] } : { theme: 'graphite', service: 'العلامة الأم' };
}
const count = (s: string, k: string) => (s || '').split(k).length - 1;

export function splitSlides(text: string): string[] {
  text = (text || '').replace(/\r/g, '');
  const idx: number[] = []; let m: RegExpExecArray | null; MARK.lastIndex = 0;
  while ((m = MARK.exec(text))) { idx.push(m.index); if (m[0].length === 0) MARK.lastIndex++; }
  if (!idx.length) return [text];
  const out: string[] = [];
  idx.forEach((a, i) => {
    let p = text.slice(a, idx[i + 1] ?? text.length);
    p = p.replace(new RegExp(MARK.source, 'm'), '');
    p = p.trim().replace(/^\s*\|?\s*(الغلاف|الهوك|الختام|CTA)\s*/i, '');
    if (p.trim()) out.push(p.trim());
  });
  return out;
}

export function kindOf(ctype: string): Post['kind'] {
  const c = (ctype || '').toLowerCase();
  if (c.includes('carousel') || c.includes('كاروسيل')) return 'carousel';
  if (c.includes('reel') || c.includes('ريل') || c.includes('video')) return 'reel';
  if (c.includes('story') || c.includes('ستوري')) return 'story';
  return 'single';
}

/** مسودة spec مبدئية (نقطة بداية فقط — Claude يطوّرها) */
export function draftSpec(post: Post): any {
  const single = post.kind !== 'carousel';
  const chunks = single ? [post.design || post.title] : splitSlides(post.design || post.title);
  const slides = chunks.map((chunk, i) => {
    const lines = chunk.split('\n').map(x => x.trim()).filter(l => l && !/^[\W_]+$/u.test(l));
    const kept = lines.filter(l => !/اقرأ\s*الكابشن|اسحب\s*ل?(معرفة|تعرف)/.test(l));
    const L = kept.length ? kept : lines;
    const items: string[] = [], body: string[] = [];
    for (const l of L.slice(1)) (BULLET.test(l) ? items : body).push(clean(l.replace(BULLET, '')));
    const sl: any = { type: 'concept', title: [clean(L[0] || '')] };
    const secs: any[] = [];
    if (body.filter(Boolean).length) secs.push({ s: 'body', t: body.filter(Boolean), fs: 30 });
    const it = items.filter(Boolean);
    if (it.length) secs.push(it.length <= 4 ? { s: 'reqs', style: 'big', items: it } : { s: 'list', style: 'plain', items: it });
    if (secs.length) sl.sections = secs;
    if (i === chunks.length - 1 && chunks.length > 1) sl.phone_line = { bottom: 120, fs: 34 };
    return sl;
  });
  const tags = (post.caption.match(/#[\w؀-ۿ_]+/g) || []);
  const cap = post.caption.replace(/#[\w؀-ۿ_]+/g, '').replace(/\s*هاشتاقات\s*:[\s\S]*$/, '').trim().replace(/^["“”]+|["“”]+$/g, '');
  return {
    name: `${String(post.n).padStart(2, '0')}_${clean(post.title).replace(/[^\w؀-ۿ]+/g, '_').slice(0, 40)}`,
    preset: single ? (post.kind === 'reel' ? 'reel_cover' : post.kind === 'story' ? 'news_story' : 'concept_single') : 'carousel_scenes',
    theme: post.theme, caption: cap, hashtags: tags.length ? tags : ['#بوابة_المستثمر'], slides,
  };
}

const HEAD: Record<string, RegExp> = {
  ctype: /content\s*type|نوع/i, platform: /platform|المنصة/i, pillar: /pillar|المحور/i, title: /title|headline|العنوان/i,
  design: /للتصميم|design\s*content/i, caption: /كابشن|caption/i, due: /تسليم|due/i, link: /رابط|link/i,
  publish: /النشر|publish/i, status: /status|الحالة/i, notes: /ملاحظات|notes/i,
};
const ORDER = ['ctype', 'platform', 'pillar', 'title', 'design', 'caption', 'due', 'link', 'publish', 'status', 'notes'];

function cellText(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r: any) => r.text).join('');
    if (v.text) return String(v.text);
    if (v.result != null) return cellText(v.result);
    if (v.hyperlink) return String(v.hyperlink);
  }
  return String(v);
}

export async function parseCalendar(buf: Buffer): Promise<Post[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('الملف ما فيه أوراق');
  // خريطة الأعمدة: من العناوين، وإلا الترتيب المعتاد لتقويم العميل
  const header = (ws.getRow(1).values as any[]).map(cellText);
  const col: Record<string, number> = {};
  for (const k of ORDER) {
    const i = header.findIndex((h, j) => j > 0 && HEAD[k].test(h) && !Object.values(col).includes(j));
    if (i > 0) col[k] = i;
  }
  ORDER.forEach((k, i) => { if (!col[k]) col[k] = i + 1; });
  const posts: Post[] = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const get = (k: string) => cellText(row.getCell(col[k]).value).trim();
    const title = get('title');
    if (!title) return;
    const design = get('design'), caption = get('caption');
    const { theme, service } = detectService(title, design, caption);
    const post = blankPost(posts.length + 1, {
      title: clean(title), ctype: get('ctype'), platform: get('platform'), pillar: get('pillar'), design, caption,
      notes: get('notes'), due: get('due'), publish: get('publish'), status: get('status'), link: get('link'),
      theme, service, kind: kindOf(get('ctype')),
    });
    posts.push(post);
  });
  if (!posts.length) throw new Error('ما لقيت منشورات بالتقويم — تأكد إن عمود العنوان معبّى');
  return posts;
}
