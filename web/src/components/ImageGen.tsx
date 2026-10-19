// توليد عناصر وصور بـ GPT Image — الوصف بالعربي، والنتيجة تنضاف لصور المنشور مباشرة
import { useEffect, useState } from 'react';
import { Wand2, Layers, Image as ImageIcon, Mountain, ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { api, postUrl, type Post, type Photo } from '../api';
import { Modal, Spinner, Segmented, useToast } from '../ui';

const KINDS = [
  { v: 'element', icon: <Layers size={15} />, label: 'عنصر شفاف', hint: 'أصل مقصوص (شخص، ملف، ختم، مبنى…) بخلفية شفافة — يتركّب بالتصميم مباشرة' },
  { v: 'photo', icon: <ImageIcon size={15} />, label: 'صورة كاملة', hint: 'لقطة كاملة بفراغ علوي للعنوان (مشهد كامل)' },
  { v: 'background', icon: <Mountain size={15} />, label: 'خلفية', hint: 'خلفية هادئة بمساحات فاضية للنص' },
] as const;
const ASPECTS = ['1:1', '4:5', '3:4', '9:16', '16:9', '3:2'];
const EXAMPLES = ['رجل أعمال سعودي بثوب أبيض وشماغ يمسك ملف أوراق ويقرأ بتركيز', 'ختم نحاسي قديم على ورقة رسمية', 'ملف أوراق مفتوح تطير منه أوراق', 'برج المملكة وقت الغروب من زاوية منخفضة', 'مفتاح نحاسي فاخر على بطاقة'];

const DRAW_EXAMPLES = ['بوصلة نحاسية فاخرة بوجه عاجي وإبرة تشير لليمين', 'مفتاح نحاسي ببطاقة ورقية مربوطة بخيط', 'ختم ذهبي بارز بشريطين', 'لوح مشبك عليه قائمة تحقق بأربعة بنود', 'ملف أوراق رسمي مختوم بختم حبر', 'ميزان ذهبي متوازن', 'تقويم ورقي عليه تاريخ محوّط بقلم'];
const SHAPES = [{ v: 'sq', label: 'مربع', w: 900, h: 900 }, { v: 'tall', label: 'طولي', w: 760, h: 1000 }, { v: 'wide', label: 'عرضي', w: 1100, h: 760 }];

export function ImageGen({ open, onClose, pid, post, prefill, onDone, imagesReady, onDraw }: { open: boolean; onClose: () => void; pid: string; post: Post; prefill?: string; onDone: (p: Post) => void;
  imagesReady?: boolean; onDraw: (description: string, w: number, h: number) => void }) {
  const [mode, setMode] = useState<'draw' | 'image'>('draw');
  const [shape, setShape] = useState('sq');
  const toast = useToast();
  const [desc, setDesc] = useState('');
  const [kind, setKind] = useState<'element' | 'photo' | 'background'>('element');
  const [aspect, setAspect] = useState('1:1');
  const [quality, setQuality] = useState('');
  const [n, setN] = useState(1);
  const [refs, setRefs] = useState<string[]>([]);
  const [adv, setAdv] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ photos: Photo[]; prompt: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (open) { setDesc(prefill || ''); setRes(null); setPrompt(''); setRefs([]); setMode(imagesReady ? 'image' : 'draw'); } }, [open, prefill]);
  useEffect(() => { setAspect(kind === 'element' ? '1:1' : '4:5'); }, [kind]);
  useEffect(() => { if (!busy) return; setElapsed(0); const t = setInterval(() => setElapsed(e => e + 1), 1000); return () => clearInterval(t); }, [busy]);

  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ photos: Photo[]; prompt: string; post: Post }>(postUrl(pid, post.id) + '/generate',
        { description: desc, kind, aspect, quality: quality || undefined, n, refs, prompt: adv && prompt.trim() ? prompt : undefined });
      setRes(r); setPrompt(r.prompt); onDone(r.post);
      toast('ok', `تولّدت ${r.photos.length} صورة وانضافت لصور المنشور`);
    } catch (e: any) { toast('err', e.message); } finally { setBusy(false); }
  };
  const src = (f: string) => `/files/projects/${pid}/posts/${post.id}/photos/${f}`;

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={<span className="flex items-center gap-2"><Wand2 size={18} className="text-gold-deep" /> عنصر جديد للتصميم</span>} wide
      footer={mode === 'draw' ? <>
        <span className="ml-auto text-[12px] text-ink-mute">«نولّد الأشياء ونصوّر الناس» — الرسم للأشياء فقط، والأشخاص صور حقيقية</span>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-gold" disabled={!desc.trim()} onClick={() => { const sh = SHAPES.find(x => x.v === shape)!; onDraw(desc.trim(), sh.w, sh.h); onClose(); }}><Wand2 size={16} /> ارسم بالكود</button>
      </> : <>
        <span className="ml-auto text-[12px] text-ink-mute flex items-center gap-1.5"><AlertTriangle size={13} /> العميل يكره شكل الذكاء الاصطناعي — راجع الواقعية قبل الاستخدام</span>
        <button className="btn-ghost" disabled={busy} onClick={onClose}>{res ? 'تم' : 'إلغاء'}</button>
        <button className="btn-gold" disabled={busy || !desc.trim()} onClick={go}>{busy ? <><Spinner /> يولّد… {elapsed}ث</> : <><Wand2 size={16} /> {res ? 'ولّد مرة ثانية' : 'ولّد'}</>}</button>
      </>}>
      <div className="mb-4"><Segmented value={mode} onChange={setMode} options={[{ v: 'draw', label: 'ارسم بالكود (Claude)' }, { v: 'image', label: 'صورة GPT Image' }]} /></div>
      {mode === 'draw' ? (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft leading-relaxed">Claude يرسم العنصر كود (SVG/CSS) بأسلوب العناصر المعتمدة — نحاس مصقول، ورق عاجي، ظلال ناعمة — ويطلع PNG شفاف بدقة عالية، ويفحصه بصرياً قبل ما يحفظه. بعدها تقدر تعدّله بالكلام من زر «عدّل».</p>
          <div>
            <label className="label">وش ترسم؟</label>
            <textarea className="input min-h-[96px] leading-relaxed" value={desc} onChange={e => setDesc(e.target.value)} placeholder="مثال: بوصلة نحاسية فاخرة بوجه عاجي وإبرة تشير لليمين" autoFocus />
            <div className="flex flex-wrap gap-1.5 mt-2">{DRAW_EXAMPLES.map(x => <button key={x} className="chip bg-white border border-ink/10 text-ink-soft hover:border-gold/60 h-7" onClick={() => setDesc(x)}>{x}</button>)}</div>
          </div>
          <div><label className="label">الشكل</label><Segmented value={shape} onChange={setShape} options={SHAPES.map(x => ({ v: x.v, label: x.label }))} /></div>
          <p className="text-[12px] text-ink-mute">يشتغل بالخلفية (حوالي دقيقة) وتشوف التقدم بسجل المصمم — والعنصر ينضاف لصور المنشور تلقائياً.</p>
        </div>
      ) : (<>
      {!imagesReady && <div className="mb-3 flex items-start gap-2 rounded-xl bg-sun/10 text-[#7a5d00] px-3 py-2 text-[12.5px]"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> RadoxAI لسا ما فعّل توليد الصور على حسابك — استخدم «ارسم بالكود» للأشياء.</div>}
      <div className="grid md:grid-cols-[1fr_240px] gap-5">
        <div className="space-y-4">
          <div>
            <label className="label">وش تبي؟ (بالعربي — يتحول لبرومبت احترافي بأسلوب الهوية)</label>
            <textarea className="input min-h-[96px] leading-relaxed" value={desc} onChange={e => setDesc(e.target.value)} placeholder="مثال: رجل أعمال سعودي بثوب أبيض يمسك ملف أوراق ويقرأ بقلق" autoFocus />
            <div className="flex flex-wrap gap-1.5 mt-2">{EXAMPLES.map(x => <button key={x} className="chip bg-white border border-ink/10 text-ink-soft hover:border-gold/60 h-7" onClick={() => setDesc(x)}>{x}</button>)}</div>
          </div>
          <div>
            <label className="label">النوع</label>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map(k => (
                <button key={k.v} onClick={() => setKind(k.v)} className={`text-right rounded-xl border p-3 transition ${kind === k.v ? 'border-gold bg-gold/[.08]' : 'border-ink/10 bg-white/70 hover:border-gold/40'}`}>
                  <div className="flex items-center gap-1.5 font-bold text-[13.5px]">{k.icon}{k.label}</div>
                  <div className="text-[11.5px] text-ink-mute mt-1 leading-relaxed">{k.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div><label className="label">المقاس</label><Segmented value={aspect} onChange={setAspect} options={ASPECTS.map(a => ({ v: a, label: <span dir="ltr">{a}</span> }))} /></div>
            <div><label className="label">العدد</label><Segmented value={String(n)} onChange={v => setN(Number(v))} options={['1', '2', '3', '4'].map(v => ({ v, label: v }))} /></div>
            <div><label className="label">الجودة</label>
              <select className="input !py-1.5 text-[13px]" value={quality} onChange={e => setQuality(e.target.value)}>
                <option value="">الافتراضي (الإعدادات)</option>{['low', 'medium', 'high', 'xhigh', 'max'].map(q => <option key={q} value={q}>{q}</option>)}
              </select></div>
          </div>
          {post.photos.length > 0 && (
            <div>
              <label className="label">صور مرجعية (اختياري — نفس الشخص/المنتج/الأسلوب)</label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {post.photos.map(p => {
                  const on = refs.includes(p.id);
                  return (
                    <button key={p.id} onClick={() => setRefs(r => on ? r.filter(x => x !== p.id) : [...r, p.id].slice(-4))}
                      className={`relative h-16 w-16 shrink-0 rounded-lg overflow-hidden border-2 ${on ? 'border-gold' : 'border-transparent'} ${p.alpha ? 'checker' : 'bg-ivory-2'}`}>
                      <img src={src(p.file)} className="w-full h-full object-contain" alt="" />
                      {on && <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-gold text-white grid place-items-center"><Check size={12} /></span>}
                    </button>);
                })}
              </div>
            </div>
          )}
          <button className="text-[12.5px] text-ink-soft flex items-center gap-1" onClick={() => setAdv(a => !a)}><ChevronDown size={14} className={adv ? 'rotate-180' : ''} /> البرومبت الإنجليزي (متقدم)</button>
          {adv && <textarea dir="ltr" className="input min-h-[90px] text-[12.5px] font-mono" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="فاضي = يكتبه الموديل السريع تلقائياً من وصفك" />}
        </div>
        <div className="rounded-2xl bg-ivory-2 p-3 min-h-[240px] flex flex-col gap-2">
          {busy ? <div className="flex-1 rounded-xl shimmer grid place-items-center text-[12px] text-ink-soft text-center px-3">GPT Image يرسم…<br />عادةً 20–90 ثانية</div>
            : res ? res.photos.map(p => (
              <div key={p.id} className={`rounded-xl overflow-hidden ${p.alpha ? 'checker' : ''}`}><img src={src(p.file)} className="w-full object-contain" alt="" /></div>
            )) : <div className="flex-1 grid place-items-center text-[12px] text-ink-mute text-center px-4">النتيجة تنضاف لصور المنشور تلقائياً، والمصمم يستخدمها بالتصميم القادم</div>}
        </div>
      </div>
      </>)}
    </Modal>
  );
}
