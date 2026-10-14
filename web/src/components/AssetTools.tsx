// أدوات الأصول المولّدة: «أصول تلقائية» (يقرأ التصميم ويولّد الأصل المناسب) + محرر الأصل (تعديلات عربية على نفس الصورة مع سجل النسخ)
import { useEffect, useMemo, useState } from 'react';
import { Wand2, Layers, Mountain, Sparkles, History, PencilLine, Check } from 'lucide-react';
import type { Post, Photo } from '../api';
import { Modal, Segmented } from '../ui';

export function AutoAssetsModal({ open, onClose, onRun, slides }: { open: boolean; onClose: () => void; slides: number;
  onRun: (o: { target: string; note?: string; slides?: number[] }) => void }) {
  const [target, setTarget] = useState('auto');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => { if (open) { setNote(''); setSel([]); } }, [open]);
  const T = [
    { v: 'auto', icon: <Sparkles size={15} />, label: 'تلقائي', hint: 'يقرر حسب التصميم' },
    { v: 'element', icon: <Layers size={15} />, label: 'عنصر', hint: 'أصل بطل/داعم شفاف' },
    { v: 'layer', icon: <Mountain size={15} />, label: 'خلفية شفافة', hint: 'طبقة خلف المحتوى' },
    { v: 'both', icon: <Wand2 size={15} />, label: 'الاثنين', hint: 'عنصر + خلفية' },
  ];
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Wand2 size={18} className="text-gold-deep" /> أصول تلقائية بـ GPT Image</span>}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-gold" onClick={() => { onRun({ target, note: note.trim() || undefined, slides: sel.length ? sel : undefined }); onClose(); }}><Wand2 size={16} /> اقرأ التصميم وولّد</button></>}>
      <p className="text-[13px] text-ink-soft leading-relaxed mb-4">موديل GPT من RadoxAI يقرأ التصميم المعروض (الصورة + الإعدادات + النص)، يقرر الأصل اللي يرفعه، GPT Image يرسمه بخلفية شفافة، ويتركّب بالتصميم كنسخة جديدة مفحوصة. بعدها تقدر تعدّل نفس الأصل بكلامك.</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {T.map(t => (
          <button key={t.v} onClick={() => setTarget(t.v)} className={`text-right rounded-xl border p-3 transition ${target === t.v ? 'border-gold bg-gold/[.08]' : 'border-ink/10 bg-white/70 hover:border-gold/40'}`}>
            <div className="flex items-center gap-1.5 font-bold text-[13.5px]">{t.icon}{t.label}</div>
            <div className="text-[11.5px] text-ink-mute mt-0.5">{t.hint}</div>
          </button>
        ))}
      </div>
      {slides > 1 && (
        <div className="mb-4">
          <label className="label">الشرائح (فاضي = يقرر بنفسه)</label>
          <div className="flex flex-wrap gap-1.5">{Array.from({ length: slides }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => setSel(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n])}
              className={`h-8 w-8 rounded-lg text-[13px] font-semibold ${sel.includes(n) ? 'bg-graphite text-ivory' : 'bg-white border border-ink/10'}`}>{n}</button>))}
          </div>
        </div>
      )}
      <label className="label">توجيه (اختياري)</label>
      <textarea className="input min-h-[70px] text-[14px]" value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: خلفية أفق الرياض وقت الغروب، أو رجل سعودي يمسك ملف" />
    </Modal>
  );
}

const QUICK = ['إضاءة أنعم وأدفى', 'أقرب للكاميرا', 'زاوية جانبية', 'بدون أي ظل', 'ألوان أهدى', 'أكثر واقعية وأقل لمعان', 'غيّر تعبير الوجه لقلق', 'أزل العناصر الزايدة'];

export function AssetEditor({ open, onClose, pid, post, photo, inUse, onEdit, onUseRevision }: {
  open: boolean; onClose: () => void; pid: string; post: Post; photo: Photo | null; inUse: (id: string) => boolean;
  onEdit: (photoId: string, instruction: string, apply: boolean) => void; onUseRevision: (from: string, to: string) => void;
}) {
  const [cur, setCur] = useState<Photo | null>(photo);
  const [ins, setIns] = useState('');
  const [apply, setApply] = useState(true);
  useEffect(() => { if (open) { setCur(photo); setIns(''); setApply(true); } }, [open, photo?.id]);
  const chain = useMemo(() => {
    if (!cur) return [];
    const root = cur.asset?.root || cur.id;
    return post.photos.filter(p => p.id === root || p.asset?.root === root).sort((a, b) => (a.asset?.rev || 1) - (b.asset?.rev || 1));
  }, [cur, post.photos]);
  if (!cur) return null;
  const src = (p: Photo) => `/files/${pid}/posts/${post.id}/photos/${p.file}`;
  const usedNow = chain.find(p => inUse(p.id));
  return (
    <Modal open={open} onClose={onClose} wide title={<span className="flex items-center gap-2"><PencilLine size={18} className="text-gold-deep" /> تعديل الأصل</span>}
      footer={<>
        {usedNow && usedNow.id !== cur.id && <button className="btn-line ml-auto" onClick={() => { onUseRevision(usedNow.id, cur.id); onClose(); }}><Check size={15} /> استخدم هذه النسخة بالتصميم</button>}
        <button className="btn-ghost" onClick={onClose}>إغلاق</button>
        <button className="btn-gold" disabled={!ins.trim()} onClick={() => { onEdit(cur.id, ins.trim(), apply); onClose(); }}><Wand2 size={16} /> طبّق التعديل</button>
      </>}>
      <div className="grid md:grid-cols-[1fr_300px] gap-5">
        <div>
          <div className={`rounded-2xl overflow-hidden ${cur.alpha ? 'checker' : 'bg-ivory-2'} grid place-items-center`} style={{ height: 380 }}>
            <img src={src(cur)} className="max-h-full max-w-full object-contain" alt="" />
          </div>
          {chain.length > 1 && (
            <div className="mt-3">
              <div className="text-[12px] text-ink-soft mb-1.5 flex items-center gap-1.5"><History size={13} /> نسخ الأصل ({chain.length})</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {chain.map(p => (
                  <button key={p.id} onClick={() => setCur(p)} className={`relative shrink-0 h-16 w-16 rounded-lg overflow-hidden border-2 ${p.id === cur.id ? 'border-gold' : 'border-transparent'} ${p.alpha ? 'checker' : 'bg-ivory-2'}`}>
                    <img src={src(p)} className="w-full h-full object-contain" alt="" />
                    <span className="absolute bottom-0 inset-x-0 text-[10px] bg-black/50 text-white">r{p.asset?.rev || 1}{inUse(p.id) ? ' ★' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">وش تبي تعدّل؟ (على نفس الصورة)</label>
            <textarea className="input min-h-[110px] text-[14px] leading-relaxed" autoFocus value={ins} onChange={e => setIns(e.target.value)} placeholder="مثال: خلّ الشماغ أبيض بدل الأحمر، والملف لونه بيج" />
            <div className="flex flex-wrap gap-1.5 mt-2">{QUICK.map(q => <button key={q} className="chip bg-white border border-ink/10 text-ink-soft hover:border-gold/60 h-7" onClick={() => setIns(x => (x ? x + '، ' : '') + q)}>{q}</button>)}</div>
          </div>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="accent-[#A29265] h-4 w-4" checked={apply} onChange={e => setApply(e.target.checked)} />
            {inUse(cur.id) ? 'استبدله بالتصميم الحالي (نسخة جديدة)' : 'استبدله بالتصميم لو كان مستخدم'}
          </label>
          {cur.asset?.history && cur.asset.history.length > 0 && (
            <div className="rounded-xl bg-ivory-2 p-3 max-h-40 overflow-auto">
              <div className="text-[11.5px] font-bold text-ink-soft mb-1">سجل التعديلات</div>
              <ol className="space-y-1">{cur.asset.history.map((h, i) => <li key={i} className="text-[12px] text-ink-soft">{i + 1}. {h.instruction || '—'}</li>)}</ol>
            </div>
          )}
          {cur.prompt && <details className="text-[11.5px] text-ink-mute"><summary className="cursor-pointer">البرومبت</summary><p dir="ltr" className="mt-1 leading-relaxed">{cur.prompt}</p></details>}
        </div>
      </div>
    </Modal>
  );
}
