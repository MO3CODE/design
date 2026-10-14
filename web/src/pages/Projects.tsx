import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, UploadCloud, Plus, Trash2, ArrowLeft, Sparkles, Layers, ShieldCheck, Gauge } from 'lucide-react';
import { api, type ProjectRow, type Project } from '../api';
import { go } from '../App';
import { Spinner, useToast, Modal, Empty } from '../ui';

export default function Projects({ health }: { health: any }) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blank, setBlank] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const load = () => api.get<ProjectRow[]>('/api/projects').then(setRows).catch(e => toast('err', e.message));
  useEffect(() => { load(); }, []);

  async function upload(f?: File) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return toast('err', 'ارفع ملف Excel بصيغة ‎.xlsx');
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const p = await api.post<Project>('/api/projects', fd);
      toast('ok', `تم استيراد ${p.posts.length} منشور من الخطة`);
      go(`/p/${p.id}`);
    } catch (e: any) { toast('err', e.message); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-gold-deep text-sm font-semibold mb-1.5">بوابة المستثمر · Investor Gate</div>
          <h1 className="font-display text-[34px] leading-tight font-bold text-graphite">ارفع خطة المحتوى… <span className="text-gold-deep">والاستوديو يصمّم</span></h1>
          <p className="text-ink-soft mt-2 max-w-2xl leading-relaxed">نفس محرك المهارة المعتمد: لون كل منشور حسب الخدمة، نص التقويم حرفياً، سجل الذوق، فحص آلي للتداخل والتباين والإملاء، وإخراج نهائي بدقة {health?.exportScale || 3}×.</p>
        </div>
        <button className="btn-line" onClick={() => setBlank(true)}><Plus size={16} /> مشروع فارغ</button>
      </header>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        onClick={() => !busy && input.current?.click()}
        className={`relative cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed transition-all ${drag ? 'border-gold bg-gold/[.07] scale-[1.005]' : 'border-ink/15 bg-white/60 hover:border-gold/60 hover:bg-white/80'}`}>
        <div className="absolute -left-16 -top-10 w-[300px] opacity-[.06] pointer-events-none"><img src="/symbol-gold.svg" alt="" /></div>
        <div className="relative flex flex-col md:flex-row items-center gap-6 p-8 md:p-10">
          <div className="h-20 w-20 rounded-2xl bg-graphite text-gold-light grid place-items-center shadow-lift shrink-0">
            {busy ? <Spinner size={30} /> : <FileSpreadsheet size={36} strokeWidth={1.6} />}
          </div>
          <div className="text-center md:text-right">
            <div className="text-xl font-bold">{busy ? 'جاري قراءة الخطة…' : 'اسحب ملف تقويم المحتوى هنا'}</div>
            <div className="text-ink-soft mt-1">Excel بنفس أعمدة تقويم العميل — نوع المحتوى، العنوان، المحتوى للتصميم، الكابشن، تاريخ النشر، ملاحظات المصمم</div>
          </div>
          <span className="btn-primary md:mr-auto pointer-events-none"><UploadCloud size={17} /> اختر الملف</span>
        </div>
        <input ref={input} type="file" accept=".xlsx" hidden onChange={e => upload(e.target.files?.[0])} />
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        {[
          { i: <Sparkles size={17} />, t: 'تصميم بالذكاء الاصطناعي', d: 'فكرة + spec + رسم + فحص بصري' },
          { i: <Gauge size={17} />, t: 'توجيه ذكي بين الموديلات', d: 'الموديل القوي للتصميم فقط — والتعديلات الصغيرة بالسريع' },
          { i: <ShieldCheck size={17} />, t: 'فحص قبل التسليم', d: 'تداخل · تباين · إملاء · قائمة المرفوض' },
        ].map(x => (
          <div key={x.t} className="flex items-start gap-3 rounded-2xl bg-white/50 border border-ink/[.06] p-4">
            <span className="h-8 w-8 rounded-lg bg-gold/15 text-gold-deep grid place-items-center shrink-0">{x.i}</span>
            <div><div className="font-bold text-[14px]">{x.t}</div><div className="text-ink-soft text-[13px] mt-0.5">{x.d}</div></div>
          </div>
        ))}
      </div>

      <h2 className="font-bold text-lg mt-12 mb-4 flex items-center gap-2"><Layers size={18} className="text-gold-deep" /> الخطط</h2>
      {!rows ? <div className="py-10 grid place-items-center"><Spinner className="text-gold" /></div> :
        !rows.length ? <div className="card"><Empty icon={<FileSpreadsheet />} title="ما فيه خطط بعد" text="ارفع تقويم المحتوى فوق، أو ابدأ مشروع فارغ وأضف المنشورات يدوياً." /></div> :
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map(r => {
            const pct = r.count ? Math.round((r.done / r.count) * 100) : 0;
            return (
              <a key={r.id} href={`#/p/${r.id}`} className="card group p-5 hover:shadow-lift hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-[16px] truncate">{r.name}</div>
                    <div className="text-ink-mute text-[12px] mt-1">آخر تحديث {new Date(r.updatedAt).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</div>
                  </div>
                  <button className="btn-icon btn-ghost opacity-0 group-hover:opacity-100 text-ink-mute hover:text-red-700" title="حذف"
                    onClick={async e => { e.preventDefault(); if (!confirm(`حذف «${r.name}» وكل تصاميمه؟`)) return; await api.del(`/api/projects/${r.id}`); load(); }}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-4 mt-5 text-[13px]">
                  <span><b className="text-[18px] text-graphite">{r.count}</b> <span className="text-ink-soft">منشور</span></span>
                  <span className="text-gold-deep"><b>{r.inReview}</b> بانتظار الاعتماد</span>
                  <span className="text-emerald-800"><b>{r.done}</b> معتمد</span>
                </div>
                <div className="h-1.5 rounded-full bg-ink/[.07] mt-3 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-gold-light to-gold-deep" style={{ width: `${pct}%` }} /></div>
                <div className="flex items-center justify-end text-gold-deep text-[13px] font-semibold mt-4 gap-1">فتح <ArrowLeft size={15} className="group-hover:-translate-x-1 transition" /></div>
              </a>
            );
          })}
        </div>}

      <Modal open={blank} onClose={() => setBlank(false)} title="مشروع فارغ"
        footer={<><button className="btn-ghost" onClick={() => setBlank(false)}>إلغاء</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={async () => { const p = await api.post<Project>('/api/projects', (() => { const f = new FormData(); f.append('name', name.trim()); return f; })()); go(`/p/${p.id}`); }}>إنشاء</button></>}>
        <label className="label">اسم المشروع</label>
        <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="مثال: خطة نوفمبر 2026" />
      </Modal>
    </div>
  );
}
