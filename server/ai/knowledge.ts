// المعرفة المرسلة للموديل — مقسّمة لوحدات، وكل نوع طلب ياخذ اللي يحتاجه فقط (توفير توكن):
// تصميم جديد = كل شي · تعديل صغير = القواعد + ملخص الحقول · فحص بصري = القواعد + الذوق + قائمة المراجعة
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, cfg } from '../config.js';
import { getTaste } from '../store.js';
import type { Task } from './router.js';

const K = (f: string) => fs.readFileSync(path.join(ENGINE, 'knowledge', f), 'utf8');
const cacheTxt = new Map<string, string>();
const once = (k: string, fn: () => string) => { if (!cacheTxt.has(k)) cacheTxt.set(k, fn()); return cacheTxt.get(k)!; };

/** SKILL.md بدون الأجزاء الخاصة بسطر الأوامر والمسارات المحلية */
const skill = () => once('skill', () => K('SKILL.md')
  .replace(/^---[\s\S]*?---\s*/, '')
  .replace(/## هيكل المهارة[\s\S]*$/, '')
  .replace(/## سير العمل[\s\S]*?(?=## الإعدادات المعتمدة)/, ''));

const presetsTxt = () => once('presets', () => fs.readFileSync(path.join(ENGINE, 'presets.json'), 'utf8'));
const brandTxt = () => once('brand', () => JSON.stringify(JSON.parse(fs.readFileSync(path.join(ENGINE, 'brand.json'), 'utf8'))));
const presetNames = () => once('pnames', () => Object.entries<any>(JSON.parse(presetsTxt())).filter(([k]) => !k.startsWith('_'))
  .map(([k, v]) => `- ${k}: ${v._doc || ''}`).join('\n'));

const EXAMPLE_FOR: Record<string, string> = {
  concept_single: 'approved_concept_single.json', carousel_scenes: 'approved_carousel_scenes.json', carousel_clean: 'approved_carousel_clean.json',
  news_story: 'approved_news_story.json', profile_echo: 'approved_profile_echo.json',
};
export function exampleFor(preset?: string) {
  const f = EXAMPLE_FOR[preset || ''] ; if (!f) return '';
  const p = path.join(ENGINE, 'examples', f); if (!fs.existsSync(p)) return '';
  return `# مثال معتمد من العميل (${preset}) — المسارات فيه محلية، استخدم صور المنشور الحالي بدلها\n${fs.readFileSync(p, 'utf8')}`;
}

const CHEATSHEET = `# ملخص سريع لحقول المحرك (للتعديلات)
- spec: format(post|story|square) · preset · theme · font(expo|thmanyah|mix|serif|plex) · logo_pos(top-left|top-center) · logo_w · safe{top,side,bottom} · texture{kind,op,boost} · span[] · pager · pager_style:"boxed" · theme_override{}
- slide: type · theme · title[] · title_fs · grow · grow_max · kashida · box · box_style:"glass" · box_fs · box_area{top,left,right,bottom} · text_h · align · topline · phone_line · glass_tag{t,y,x,fs,icon} · warn_glass{x,y,size,fs0,fs1,lines[]} · sections[] · floor · backdrop{kind:"motif",cx,cy,w,sa,z} · bg_photo{src,treat,blend,opacity,pos}
- photo: src · area(cutout|full|bottom|top|left|right|center) · side · h · w · bottom · x · gap · max_h · max_w · fit:"auto" · flip · treat(none|natural|warm|noir|mono|sepia|gold) · grain · shadow · shadow_h · fade_bottom · shift · fg · crop[x0,y0,x1,y1]
- أقسام sections[].s: body{t[],fs} · reqs{style:"big",items[]} · list{style,items[]} · duo{style:"open",items[{tone,icon,t,d}]} · chipsx · hl · table{cols,rows} · ctx · ncard · regions · meta · divider · heading · gap{h}`;

export function systemFor(task: Task, preset?: string): string[] {
  const core = K('web-core.md');
  const taste = `# سجل ذوق المستخدم (المعتمد والمرفوض — إلزامي)\n${getTaste()}`;
  const ref = `# مرجع المحرك\n${K('engine-reference.md')}`;
  const blocks: string[] = [core];
  switch (task) {
    case 'design': case 'variant': case 'revise_major':
      blocks.push(`# دليل المهارة (القواعد والإعدادات والأدوات)\n${skill()}`, ref,
        `# المنهج الإبداعي\n${K('creative-concepts.md')}`, `# دليل المحتوى\n${K('content-playbook.md')}`,
        `# brand.json\n${brandTxt()}`, `# presets.json (الإعدادات المعتمدة)\n${presetsTxt()}`, taste);
      if (cfg.includeEngineSource && task === 'design') blocks.push(`# كود المحرك slide.html (المرجع النهائي لأسماء الحقول)\n${fs.readFileSync(path.join(ENGINE, 'slide.html'), 'utf8')}`);
      break;
    case 'revise': case 'fix':
      blocks.push(ref, `# الإعدادات المعتمدة\n${presetNames()}`, `# brand.json\n${brandTxt()}`, taste);
      break;
    case 'revise_minor':
      blocks.push(CHEATSHEET);
      break;
    case 'review':
      blocks.push(CHEATSHEET, taste, `# قائمة المراجعة\n${(skill().match(/## قائمة المراجعة[\s\S]*?(?=\n## |$)/) || [''])[0]}`);
      break;
    case 'caption':
      blocks.push(`# دليل المحتوى\n${K('content-playbook.md')}`, `# brand.json\n${brandTxt()}`);
      break;
    case 'plan':
      blocks.push(`# المنهج الإبداعي\n${K('creative-concepts.md')}`, `# اللون حسب الخدمة\n${(skill().match(/## اللون حسب الخدمة[\s\S]*?(?=\n## )/) || [''])[0]}`, taste);
      break;
  }
  if (['design', 'variant', 'revise_major'].includes(task)) { const ex = exampleFor(preset); if (ex) blocks.push(ex); }
  return blocks;
}
