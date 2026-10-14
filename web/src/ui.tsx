import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react';

/* ── التنبيهات ── */
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems(x => [...x, { id, kind, text }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), kind === 'err' ? 7000 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-5 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-40px))]">
        {items.map(t => (
          <div key={t.id} className={`fade-in flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lift border ${
            t.kind === 'err' ? 'bg-[#2b1d1d] text-red-100 border-red-900/40' : 'bg-graphite text-ivory border-white/10'}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} className="text-gold-light shrink-0 mt-px" /> : t.kind === 'err' ? <AlertTriangle size={18} className="text-red-300 shrink-0 mt-px" /> : <Info size={18} className="text-gold-light shrink-0 mt-px" />}
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean | 'xl'; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-graphite/55 backdrop-blur-[3px] fade-in" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`card bg-ivory w-full ${wide === 'xl' ? 'max-w-[1200px]' : wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-ink/10 shrink-0">
          <div className="font-bold text-[17px]">{title}</div>
          <button className="btn-icon btn-ghost" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-ink/10 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export const Spinner = ({ size = 16, className = '' }: { size?: number; className?: string }) => <Loader2 size={size} className={`animate-spin ${className}`} />;

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-gold/12 text-gold-deep grid place-items-center mb-4">{icon}</div>
      <div className="font-bold text-lg">{title}</div>
      {text && <p className="text-ink-soft mt-1.5 max-w-md leading-relaxed">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Swatch({ colors, size = 18 }: { colors: string[]; size?: number }) {
  return (
    <span className="inline-flex shrink-0 rounded-full overflow-hidden ring-1 ring-black/10" style={{ width: size, height: size }}>
      <span style={{ background: colors[0], width: '60%' }} /><span style={{ background: colors[1], width: '40%' }} />
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-ink/[.06] p-1 gap-1">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`h-8 px-3 rounded-lg text-[13px] font-semibold transition ${value === o.v ? 'bg-white shadow-card text-ink' : 'text-ink-soft hover:text-ink'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="inline-flex items-center gap-2.5 text-sm">
      <span className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-gold' : 'bg-ink/20'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'right-[22px]'}`} />
      </span>
      {label}
    </button>
  );
}

export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, col = score >= 95 ? '#3f7d5a' : score >= 80 ? '#A29265' : '#b4532a';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,.08)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[13px] font-bold" style={{ color: col }}>{score}</span>
    </div>
  );
}
