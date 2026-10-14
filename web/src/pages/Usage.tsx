import { useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, AlertTriangle, Save, Radio, Image as ImageIcon, Brain, Database, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { api, TIER_LABEL } from '../api';
import { Spinner, Empty, useToast, Segmented } from '../ui';
import { useLiveUsage, fmtTok, fmtCost, type Agg } from '../usage';

const TASK_LABEL: Record<string, string> = {
  design: 'تصميم جديد', variant: 'خيار بديل', revise_major: 'تعديل كبير', revise: 'تعديل', revise_minor: 'تعديل صغير',
  fix: 'إصلاح الفحص', review: 'فحص بصري', caption: 'الكابشن', plan: 'تحليل', image: 'توليد صورة', image_edit: 'صورة بمرجع', image_prompt: 'برومبت الصورة',
};
const TIER_L: Record<string, string> = { ...TIER_LABEL, image: 'GPT Image' };

export default function UsagePage() {
  const [u, setU] = useState<any>(null);
  const [names, setNames] = useState<{ projects: Record<string, string>; posts: Record<string, string> }>({ projects: {}, posts: {} });
  const [tab, setTab] = useState<'model' | 'task' | 'tier' | 'post' | 'day'>('model');
  const [live, setLive] = useState(false);
  const timer = useRef<any>(null);
  const load = () => api.get('/api/usage').then(setU);
  useEffect(() => {
    load();
    api.get<any[]>('/api/projects').then(async ps => {
      const projects: Record<string, string> = {}, posts: Record<string, string> = {};
      for (const p of ps) { projects[p.id] = p.name; const full = await api.get<any>(`/api/projects/${p.id}`); for (const x of full.posts) posts[x.id] = `#${x.n} ${x.title}`; }
      setNames({ projects, posts });
    }).catch(() => {});
  }, []);
  // كل استدعاء جديد → نحدّث الصفحة (مع تجميع خفيف)
  useLiveUsage(ev => {
    if (ev.type !== 'row') return;
    setLive(true); setTimeout(() => setLive(false), 1200);
    clearTimeout(timer.current); timer.current = setTimeout(load, 400);
  });
  if (!u) return <div className="h-full grid place-items-center"><Spinner className="text-gold" /></div>;
  const over = u.budget > 0 && u.month.cost > u.budget;
  const groups: Record<string, [Record<string, Agg>, (k: string) => string]> = {
    model: [u.byModel, k => k], task: [u.byTask, k => TASK_LABEL[k] || k], tier: [u.byTier, k => TIER_L[k] || k],
    post: [u.byPost, k => names.posts[k] || k], day: [u.byDay, k => k],
  };
  const [data, label] = groups[tab];

  return (
    <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-10">
      <div className="flex items-end gap-4 mb-6">
        <div>
          <h1 className="font-display text-[28px] font-bold text-graphite flex items-center gap-2">صرف التوكن
            <span className={`chip ${live ? 'bg-gold text-white' : 'bg-emerald-600/12 text-emerald-800'} transition`}><Radio size={12} /> مباشر</span></h1>
          <p className="text-ink-soft mt-1">كل استدعاء ينحسب لحظة حدوثه: الدخل، الطلع، التفكير المخفي، الكاش، والصور — حسب الموديل والمهمة والمنشور.</p>
        </div>
      </div>
      {over && <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm"><AlertTriangle size={16} /> تعدّيت حد الشهر (${u.budget})</div>}
      {u.unpriced.length > 0 && u.all.calls > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-sun/10 text-[#7a5d00] px-4 py-3 text-[13px] leading-relaxed">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>RadoxAI ما يرجّع أسعار — التكلفة تظهر بعد ما تعبّي أسعار هذي الموديلات بالجدول تحت: <b dir="ltr">{u.unpriced.join(' · ')}</b>. التوكن محسوب كامل بكل الأحوال.</span>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {[{ l: 'اليوم', a: u.today }, { l: 'هذا الشهر', a: u.month }, { l: 'الإجمالي', a: u.all }].map(x => (
          <div key={x.l} className="card p-5">
            <div className="flex items-baseline justify-between"><span className="text-ink-soft text-[13px]">{x.l}</span><span className="text-[12px] text-ink-mute">{x.a.calls} طلب</span></div>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="font-display text-[30px] font-bold" dir="ltr">{fmtTok(x.a.tokens)}</span>
              <span className="text-[13px] text-ink-soft">توكن</span>
              <span className="mr-auto font-bold text-[18px] text-gold-deep">{fmtCost(x.a)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-[12px] text-ink-soft">
              <span className="flex items-center gap-1.5"><ArrowDownToLine size={12} /> دخل {fmtTok(x.a.input)}</span>
              <span className="flex items-center gap-1.5"><ArrowUpFromLine size={12} /> طلع {fmtTok(x.a.output)}</span>
              <span className="flex items-center gap-1.5"><Brain size={12} /> تفكير {fmtTok(x.a.reasoning)}</span>
              <span className="flex items-center gap-1.5"><Database size={12} /> كاش {fmtTok(x.a.cached)}</span>
              <span className="flex items-center gap-1.5 col-span-2"><ImageIcon size={12} /> صور مولّدة {x.a.images}</span>
            </div>
          </div>
        ))}
      </div>

      {!u.all.calls ? <div className="card"><Empty icon={<Wallet />} title="ما فيه استهلاك بعد" text="أول ما تصمّم أو تولّد صورة، تظهر هنا الأرقام لحظياً." /></div> : <>
        <div className="card p-5 mb-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="font-bold">التوزيع</h3>
            <Segmented value={tab} onChange={setTab} options={[{ v: 'model', label: 'الموديل' }, { v: 'task', label: 'المهمة' }, { v: 'tier', label: 'المستوى' }, { v: 'post', label: 'المنشور' }, { v: 'day', label: 'اليوم' }]} />
          </div>
          <Breakdown data={data} label={label} sort={tab === 'day' ? 'key' : 'tokens'} />
        </div>

        <div className="card overflow-hidden mb-4">
          <div className="px-5 py-3 font-bold border-b border-ink/10 flex items-center gap-2">آخر الطلبات <span className="text-[12px] font-normal text-ink-mute">(تتحدث مباشرة)</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[860px]">
              <thead className="text-ink-mute text-right"><tr className="border-b border-ink/[.06]">
                <th className="px-5 py-2 font-semibold">الوقت</th><th className="font-semibold">المهمة</th><th className="font-semibold">المنشور</th><th className="font-semibold">الموديل</th>
                <th className="font-semibold">دخل</th><th className="font-semibold">طلع</th><th className="font-semibold">تفكير</th><th className="font-semibold">كاش</th><th className="font-semibold">الزمن</th><th className="font-semibold px-5">التكلفة</th></tr></thead>
              <tbody>{u.recent.filter((r: any) => r.task !== '__prices').map((r: any, i: number) => (
                <tr key={r.at + i} className={`border-b border-ink/[.04] last:border-0 ${i === 0 && live ? 'bg-gold/10' : ''}`}>
                  <td className="px-5 py-2 text-ink-mute whitespace-nowrap">{new Date(r.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                  <td>{TASK_LABEL[r.task] || r.task}{r.kind === 'image' && r.usage.images ? ` ×${r.usage.images}` : ''}</td>
                  <td className="max-w-[180px] truncate" title={names.posts[r.post]}>{names.posts[r.post] || '—'}</td>
                  <td dir="ltr" className="text-right">{r.model}</td>
                  <td>{fmtTok(r.usage.input)}</td><td>{fmtTok(r.usage.output)}</td><td>{fmtTok(r.usage.reasoning || 0)}</td><td>{fmtTok(r.usage.cacheRead || 0)}</td>
                  <td>{(r.ms / 1000).toFixed(1)}ث</td><td className="px-5 font-semibold">{r.cost === undefined || r.cost === null ? '—' : `$${r.cost.toFixed(4)}`}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      </>}

      <PriceTable onSaved={load} />
    </div>
  );
}

function Breakdown({ data, label, sort }: { data: Record<string, Agg>; label: (k: string) => string; sort: 'tokens' | 'key' }) {
  const rows = useMemo(() => Object.entries(data).sort((a, b) => sort === 'key' ? b[0].localeCompare(a[0]) : b[1].tokens - a[1].tokens), [data, sort]);
  const max = Math.max(1, ...rows.map(r => r[1].tokens));
  if (!rows.length) return <div className="text-ink-mute text-sm">لا يوجد</div>;
  return (
    <div className="space-y-3">
      {rows.map(([k, v]) => (
        <div key={k}>
          <div className="flex items-center text-[13px] gap-3">
            <span className="font-semibold truncate max-w-[45%]" dir="auto">{label(k)}</span>
            <span className="text-ink-mute text-[12px] whitespace-nowrap">{v.calls} طلب · دخل {fmtTok(v.input)} · طلع {fmtTok(v.output)}{v.reasoning ? ` · تفكير ${fmtTok(v.reasoning)}` : ''}{v.images ? ` · ${v.images} صورة` : ''}</span>
            <span className="mr-auto font-bold whitespace-nowrap" dir="ltr">{fmtTok(v.tokens)}</span>
            <span className="w-20 text-left font-semibold text-gold-deep">{fmtCost(v)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/[.06] mt-1.5"><div className="h-full rounded-full bg-gradient-to-l from-gold-light to-gold-deep transition-all" style={{ width: `${(v.tokens / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function PriceTable({ onSaved }: { onSaved: () => void }) {
  const [rows, setRows] = useState<{ id: string; in?: number; out?: number; effective?: any }[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { in?: string; out?: string }>>({});
  const [filter, setFilter] = useState('');
  const toast = useToast();
  useEffect(() => { api.get<any[]>('/api/prices').then(setRows); }, []);
  if (!rows) return null;
  const save = async () => {
    const s = await api.get<any>('/api/settings');
    const prices = { ...(s.prices || {}) };
    for (const [id, v] of Object.entries(edit)) {
      const i = v.in === '' ? undefined : v.in !== undefined ? Number(v.in) : prices[id]?.in;
      const o = v.out === '' ? undefined : v.out !== undefined ? Number(v.out) : prices[id]?.out;
      if (i === undefined && o === undefined) delete prices[id]; else prices[id] = { in: i, out: o };
    }
    await api.put('/api/settings', { prices });
    setEdit({}); setRows(await api.get('/api/prices')); onSaved(); toast('ok', 'انحفظت الأسعار — كل الأرقام انحسبت من جديد');
  };
  const shown = rows.filter(r => !filter || r.id.includes(filter));
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h3 className="font-bold">أسعار الموديلات</h3>
        <span className="text-[12px] text-ink-mute">دولار لكل مليون توكن — انسخها من صفحة أسعار RadoxAI</span>
        <input className="input !w-48 !py-1.5 text-[13px] mr-auto" dir="ltr" placeholder="بحث…" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn-primary btn-sm" disabled={!Object.keys(edit).length} onClick={save}><Save size={14} /> حفظ</button>
      </div>
      <p className="text-[12px] text-ink-mute mb-3">لو غيّرت السعر بعدين، كل التكاليف السابقة تنحسب من جديد بالسعر الجديد. التوكن المكاش يُحسب بـ 10% من سعر الدخل.</p>
      <div className="grid sm:grid-cols-2 gap-x-6">
        {shown.map(r => (
          <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-ink/[.05]">
            <span className="text-[12.5px] flex-1 truncate" dir="ltr">{r.id}</span>
            {(['in', 'out'] as const).map(k => (
              <input key={k} type="number" min={0} step="0.01" placeholder={k === 'in' ? 'دخل' : 'طلع'} dir="ltr"
                className="w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-[12.5px] outline-none focus:border-gold"
                value={edit[r.id]?.[k] ?? (r[k] ?? '')} onChange={e => setEdit(x => ({ ...x, [r.id]: { ...x[r.id], [k]: e.target.value } }))} />
            ))}
            <span className={`h-2 w-2 rounded-full ${r.effective ? 'bg-emerald-500' : 'bg-ink/15'}`} title={r.effective ? 'مسعّر' : 'بدون سعر'} />
          </div>
        ))}
      </div>
    </div>
  );
}
