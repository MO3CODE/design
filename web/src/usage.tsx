// عدّاد التوكن المباشر — يتحدث لحظياً مع كل استدعاء (SSE من /api/usage/live)
import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

export interface Agg { calls: number; input: number; output: number; reasoning: number; cached: number; images: number; tokens: number; cost: number; priced: boolean }
export interface LiveTotals { today: Agg; month: Agg; all: Agg; budget: number }

type Listener = (ev: { type: 'row' | 'totals'; data: any }) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let lastTotals: LiveTotals | null = null;

function ensure() {
  if (es) return;
  es = new EventSource('/api/usage/live');
  es.addEventListener('totals', e => { lastTotals = JSON.parse((e as MessageEvent).data); listeners.forEach(l => l({ type: 'totals', data: lastTotals })); });
  es.addEventListener('row', e => { const d = JSON.parse((e as MessageEvent).data); listeners.forEach(l => l({ type: 'row', data: d })); });
  es.onerror = () => { es?.close(); es = null; setTimeout(() => listeners.size && ensure(), 4000); };
}

/** يستدعي cb مع كل حدث (سطر استهلاك جديد أو إجماليات) */
export function useLiveUsage(cb: Listener) {
  const ref = useRef(cb); ref.current = cb;
  useEffect(() => {
    const l: Listener = ev => ref.current(ev);
    listeners.add(l); ensure();
    if (lastTotals) l({ type: 'totals', data: lastTotals });
    return () => { listeners.delete(l); };
  }, []);
}

export const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n || 0));
export const fmtCost = (a?: { cost: number; priced?: boolean }) => !a ? '—' : a.cost === 0 && a.priced === false ? '—' : `$${a.cost < 1 ? a.cost.toFixed(3) : a.cost.toFixed(2)}${a.priced === false ? '+' : ''}`;

/** شارة الشريط الجانبي */
export function UsageMeter({ compact }: { compact?: boolean }) {
  const [t, setT] = useState<LiveTotals | null>(null);
  const [flash, setFlash] = useState(false);
  useLiveUsage(ev => {
    if (ev.type === 'totals') setT(ev.data);
    if (ev.type === 'row' && ev.data.task !== '__prices') { setFlash(true); setTimeout(() => setFlash(false), 900); }
  });
  const over = t && t.budget > 0 && t.month.cost > t.budget;
  return (
    <a href="#/usage" title="صرف التوكن — يتحدث مباشرة"
      className={`block rounded-xl border px-3 py-2.5 transition ${flash ? 'border-gold-light/70 bg-gold/15' : over ? 'border-red-400/40 bg-red-500/10' : 'border-white/10 bg-white/[.04] hover:bg-white/[.07]'}`}>
      <div className="flex items-center gap-2 text-[11px] text-ivory/50">
        <Activity size={13} className={flash ? 'text-gold-light' : ''} />
        {!compact && <span>اليوم</span>}
        <span className="mr-auto h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
      </div>
      <div className={`font-bold text-ivory ${compact ? 'text-[11px] mt-1 text-center' : 'text-[15px] mt-0.5'}`} dir="ltr">{t ? fmtTok(t.today.tokens) : '…'}</div>
      {!compact && t && (
        <div className="text-[11px] text-ivory/45 mt-0.5 flex justify-between" dir="rtl">
          <span>{fmtCost(t.today)}</span><span>الشهر {fmtCost(t.month)}</span>
        </div>
      )}
    </a>
  );
}
