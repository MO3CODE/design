import { useEffect, useState } from 'react';
import { Wallet, AlertTriangle } from 'lucide-react';
import { api, money, TIER_LABEL } from '../api';
import { Spinner, Empty } from '../ui';

const TASK_LABEL: Record<string, string> = {
  design: 'تصميم جديد', variant: 'خيار بديل', revise_major: 'تعديل كبير', revise: 'تعديل', revise_minor: 'تعديل صغير',
  fix: 'إصلاح الفحص', review: 'فحص بصري', caption: 'الكابشن', plan: 'تحليل',
};

export default function UsagePage() {
  const [u, setU] = useState<any>(null);
  useEffect(() => { api.get('/api/usage').then(setU); }, []);
  if (!u) return <div className="h-full grid place-items-center"><Spinner className="text-gold" /></div>;
  const over = u.budget > 0 && u.month > u.budget;
  const Table = ({ data, label }: { data: Record<string, any>; label: (k: string) => string }) => {
    const rows = Object.entries<any>(data).sort((a, b) => b[1].cost - a[1].cost);
    const max = Math.max(1e-9, ...rows.map(r => r[1].cost));
    return (
      <div className="space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="flex items-center text-[13px] gap-2"><span className="font-semibold truncate" dir="auto">{label(k)}</span>
              <span className="text-ink-mute text-[12px]">{v.calls} طلب · {(v.input + v.output).toLocaleString('en')} توكن</span><span className="mr-auto font-bold">{money(v.cost)}</span></div>
            <div className="h-1.5 rounded-full bg-ink/[.06] mt-1.5"><div className="h-full rounded-full bg-gold" style={{ width: `${(v.cost / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div className="max-w-[1080px] mx-auto px-6 lg:px-10 py-10">
      <h1 className="font-display text-[28px] font-bold text-graphite">الاستهلاك والتكلفة</h1>
      <p className="text-ink-soft mt-1 mb-6">كل استدعاء للموديلات مسجّل — نوع الطلب، المستوى، الموديل، التوكن، والتكلفة (حسب أسعار المنصة).</p>
      {!u.calls ? <div className="card"><Empty icon={<Wallet />} title="ما فيه استهلاك بعد" text="أول ما تصمّم، تظهر هنا التكلفة لكل منشور وموديل." /></div> : <>
        {over && <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm"><AlertTriangle size={16} /> تعدّيت حد الشهر ({money(u.budget)})</div>}
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          {[{ l: 'هذا الشهر', v: money(u.month) }, { l: 'الإجمالي', v: money(u.total) }, { l: 'عدد الطلبات', v: u.calls.toLocaleString('en') }].map(x => (
            <div key={x.l} className="card p-5"><div className="text-ink-soft text-[13px]">{x.l}</div><div className="font-display text-[28px] font-bold mt-1">{x.v}</div></div>
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card p-5"><h3 className="font-bold mb-4">حسب المستوى</h3><Table data={u.byTier} label={k => TIER_LABEL[k] || k} /></div>
          <div className="card p-5"><h3 className="font-bold mb-4">حسب نوع الطلب</h3><Table data={u.byTask} label={k => TASK_LABEL[k] || k} /></div>
          <div className="card p-5"><h3 className="font-bold mb-4">حسب الموديل</h3><Table data={u.byModel} label={k => k} /></div>
        </div>
        <div className="card mt-4 overflow-hidden">
          <div className="px-5 py-3 font-bold border-b border-ink/10">آخر الطلبات</div>
          <table className="w-full text-[13px]">
            <thead className="text-ink-mute text-right"><tr className="border-b border-ink/[.06]"><th className="px-5 py-2 font-semibold">الوقت</th><th className="font-semibold">الطلب</th><th className="font-semibold">المستوى</th><th className="font-semibold">الموديل</th><th className="font-semibold">توكن</th><th className="font-semibold px-5">التكلفة</th></tr></thead>
            <tbody>{u.recent.map((r: any, i: number) => (
              <tr key={i} className="border-b border-ink/[.04] last:border-0">
                <td className="px-5 py-2 text-ink-mute">{new Date(r.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{TASK_LABEL[r.task] || r.task}</td><td>{TIER_LABEL[r.tier] || r.tier}</td><td dir="ltr" className="text-right">{r.model}</td>
                <td>{(r.usage.input + r.usage.output).toLocaleString('en')}</td><td className="px-5 font-semibold">{money(r.cost)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
