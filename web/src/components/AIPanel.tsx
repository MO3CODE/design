import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Copy, ThumbsUp, ThumbsDown, Wand2, Cpu, CheckCircle2, AlertTriangle, Camera, Lightbulb, SpellCheck, BookmarkPlus, StopCircle, Activity } from 'lucide-react';
import { TIER_LABEL, money, type Post, type Version } from '../api';
import { fmtTok } from '../usage';
import { Spinner, Modal } from '../ui';

export interface LogEv { type: string; text?: string; tier?: string; model?: string; reason?: string; task?: string; cost?: number; input?: number; output?: number;
  level?: string; ok?: boolean; issues?: string[]; variant?: number; score?: number; at: number }

const QUICK = ['كبّر الأصل شوي', 'صغّر العنوان', 'الشعار بالوسط فوق', 'خفّف التكستشر', 'اقلب الأصل', 'شريحة الختام داكنة', 'وسّع المسافات'];

export function AIPanel({ post, version, busy, log, aiReady, onDesign, onRevise, onVariants, onVerdict, onCaption, onCancel, onGenerate }: {
  post: Post; version?: Version; busy: boolean; log: LogEv[]; aiReady: boolean; onCancel: () => void; onGenerate: (desc: string) => void;
  onDesign: (direction?: string) => void; onRevise: (fb: string) => void; onVariants: (n: number) => void;
  onVerdict: (v: 'approved' | 'rejected' | null, note: string, toTaste: boolean) => void; onCaption: () => void;
}) {
  const [msg, setMsg] = useState('');
  const [direction, setDirection] = useState('');
  const [verdict, setVerdict] = useState<null | 'approved' | 'rejected'>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [log.length, post.chat.length]);
  const hasVersions = post.versions.length > 0;
  const send = () => { const t = msg.trim(); if (!t || busy) return; onRevise(t); setMsg(''); };

  return (
    <div className="h-full flex flex-col">
      {/* الفكرة والملاحظات للنسخة المعروضة */}
      {version && (
        <div className="p-4 border-b border-ink/10 space-y-3 shrink-0 max-h-[38%] overflow-auto">
          <div className="flex items-center gap-2">
            <span className="chip bg-graphite text-ivory">v{version.n}</span>
            <span className="text-[12px] text-ink-mute truncate">{version.label || (version.source === 'manual' ? 'تعديل يدوي' : 'ذكاء اصطناعي')}</span>
            {version.verdict === 'approved' && <span className="chip bg-emerald-600/12 text-emerald-800 mr-auto"><CheckCircle2 size={12} />معتمد</span>}
            {version.verdict === 'rejected' && <span className="chip bg-red-600/10 text-red-800 mr-auto">مرفوض</span>}
          </div>
          {version.concept && <div className="flex gap-2 text-[13.5px] leading-relaxed"><Lightbulb size={15} className="text-gold-deep shrink-0 mt-1" /><span>{version.concept}</span></div>}
          {!!version.notes?.length && (
            <ul className="space-y-1.5">
              {version.notes.map((n, i) => (
                <li key={i} className={`text-[12.5px] leading-relaxed flex gap-2 ${n.startsWith('📷') ? 'text-[#7a5d00] bg-sun/10 rounded-lg px-2 py-1' : 'text-ink-soft'}`}>
                  {n.startsWith('📷') ? <Camera size={13} className="shrink-0 mt-0.5" /> : <span className="h-1 w-1 rounded-full bg-gold mt-2 shrink-0" />}<span className="flex-1">{n.replace(/^📷\s*/, '')}</span>
                  {n.startsWith('📷') && <button className="shrink-0 chip bg-gold text-white h-6 hover:bg-gold-deep" onClick={() => onGenerate(n.replace(/^📷\s*(مطلوب:)?\s*/, ''))}><Wand2 size={11} /> ولّد</button>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <button className="btn-sm btn flex-1 bg-emerald-700 text-white hover:bg-emerald-800" disabled={busy} onClick={() => setVerdict('approved')}><ThumbsUp size={14} /> اعتماد</button>
            <button className="btn-sm btn-line flex-1" disabled={busy} onClick={() => setVerdict('rejected')}><ThumbsDown size={14} /> رفض</button>
          </div>
        </div>
      )}

      {/* المحادثة + سجل التقدم */}
      <div ref={logRef} className="flex-1 overflow-auto p-4 space-y-2.5">
        {!hasVersions && !busy && (
          <div className="rounded-2xl bg-graphite text-ivory p-5 relative overflow-hidden">
            <div className="absolute -left-10 -bottom-12 w-44 opacity-10"><img src="/symbol-gold.svg" alt="" /></div>
            <Sparkles className="text-gold-light mb-2" size={22} />
            <div className="font-bold text-[16px]">جاهز للتصميم</div>
            <p className="text-ivory/60 text-[13px] leading-relaxed mt-1">يقرأ المحتوى والصور، يختار الفكرة والإعداد المعتمد ولون الخدمة، يرسم، ويفحص نفسه قبل ما يسلّمك.</p>
            <textarea className="w-full mt-3 rounded-xl bg-white/[.06] border border-white/10 p-3 text-[13px] outline-none focus:border-gold-light/50 placeholder:text-ivory/35 min-h-[64px]"
              placeholder="توجيه اختياري: مثلاً «استخدم المشهد الكامل بالخلفية» أو «ثيم داكن»" value={direction} onChange={e => setDirection(e.target.value)} />
            <button className="btn-gold w-full mt-3 h-11" disabled={!aiReady} onClick={() => onDesign(direction.trim() || undefined)}><Wand2 size={17} /> صمّم الآن</button>
            {!aiReady && <a href="#/settings" className="block text-center text-[12px] text-sun mt-2">أضف مفتاح الـ API من الإعدادات أولاً</a>}
          </div>
        )}
        {post.chat.map(m => (
          <div key={m.id} className={`fade-in max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${m.role === 'user' ? 'bg-graphite text-ivory mr-auto rounded-bl-md' : 'bg-white border border-ink/10 rounded-br-md'}`}>{m.text}</div>
        ))}
        {(log.length > 0 || busy) && (
          <div className="rounded-2xl bg-white/70 border border-ink/10 p-3 space-y-1.5">
            {log.map((e, i) => <LogLine key={i} e={e} last={i === log.length - 1 && busy} />)}
            <JobMeter log={log} />
            {busy && (
              <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-ink/[.06]">
                <span className="text-[11.5px] text-ink-mute leading-relaxed">يشتغل على السيرفر — تقدر تطلع من الصفحة وترجع، والعمل يكمل.</span>
                <button className="btn-ghost btn-sm text-red-700 mr-auto shrink-0" onClick={onCancel}><StopCircle size={14} /> إيقاف</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* الإدخال */}
      {hasVersions && (
        <div className="p-3 border-t border-ink/10 shrink-0 space-y-2.5 bg-white/40">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
            {QUICK.map(q => <button key={q} className="chip bg-white border border-ink/10 text-ink-soft hover:text-ink hover:border-gold/50 shrink-0 h-7" disabled={busy} onClick={() => setMsg(m => (m ? m + '، ' : '') + q)}>{q}</button>)}
          </div>
          <div className="relative">
            <textarea className="input pl-12 min-h-[76px] max-h-40 text-[14px] leading-relaxed resize-none" placeholder="اكتب ملاحظتك على التصميم… (Ctrl+Enter للإرسال)" value={msg}
              onChange={e => setMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} disabled={busy} />
            <button className="absolute left-2 bottom-2 h-9 w-9 rounded-lg bg-graphite text-ivory grid place-items-center disabled:opacity-40" disabled={busy || !msg.trim()} onClick={send}>
              {busy ? <Spinner size={16} /> : <Send size={16} className="-scale-x-100" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn-line btn-sm flex-1" disabled={busy || !aiReady} onClick={() => onVariants(2)} title="خيارين مختلفين للمقارنة جنب بعض"><Copy size={14} /> خيارات بديلة</button>
            <button className="btn-line btn-sm flex-1" disabled={busy || !aiReady} onClick={() => onDesign()}><Sparkles size={14} /> تصميم من جديد</button>
            <button className="btn-line btn-sm" disabled={busy || !aiReady} onClick={onCaption} title="تدقيق إملائي للكابشن (أرخص موديل)"><SpellCheck size={14} /></button>
          </div>
        </div>
      )}

      <VerdictModal kind={verdict} onClose={() => setVerdict(null)} onSubmit={(note, toTaste) => { onVerdict(verdict, note, toTaste); setVerdict(null); }} />
    </div>
  );
}

/** إجمالي صرف المهمة الحالية — يتحدث مع كل استدعاء */
function JobMeter({ log }: { log: LogEv[] }) {
  const u = log.filter(e => e.type === 'usage');
  if (!u.length) return null;
  const inp = u.reduce((s, e) => s + (e.input || 0), 0), out = u.reduce((s, e) => s + (e.output || 0), 0);
  const priced = u.every(e => typeof e.cost === 'number'), cost = u.reduce((s, e) => s + (e.cost || 0), 0);
  return (
    <div className="flex items-center gap-2 text-[12px] bg-ivory-2 rounded-lg px-2.5 py-1.5 mt-1">
      <Activity size={13} className="text-gold-deep" /><span className="font-semibold">هذه المهمة:</span>
      <span dir="ltr">{fmtTok(inp + out)}</span><span className="text-ink-mute">توكن ({u.length} استدعاء)</span>
      <span className="mr-auto font-bold text-gold-deep">{priced ? money(cost) : cost ? money(cost) + '+' : '—'}</span>
    </div>
  );
}

function LogLine({ e, last }: { e: LogEv; last: boolean }) {
  if (e.type === 'route') return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-ink-mute"><Cpu size={12} className="text-gold-deep" />
      <span className="chip h-5 bg-gold/12 text-gold-deep">{TIER_LABEL[e.tier || ''] || e.tier}</span><span className="truncate ltr" dir="ltr">{e.model}</span>
      {e.variant && <span className="chip h-5 bg-ink/5">خيار {e.variant}</span>}</div>);
  if (e.type === 'usage') return <div className="text-[11px] text-ink-mute pr-5" dir="rtl">{(e.input || 0).toLocaleString('en')} → {(e.output || 0).toLocaleString('en')} توكن · {money(e.cost)}</div>;
  if (e.type === 'review') return (
    <div className={`text-[12.5px] flex gap-1.5 ${e.ok ? 'text-emerald-800' : 'text-gold-deep'}`}>
      {e.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
      <span>{e.ok ? 'الفحص البصري: ممتاز' : `الفحص البصري: ${e.issues?.join(' · ')}`}</span></div>);
  if (e.type === 'qc') return <div className="text-[12px] text-ink-soft pr-5">الفحص الآلي: {e.score}/100</div>;
  if (e.type === 'log') return <div className="text-[12px] text-[#8a5a00] flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{e.text}</div>;
  if (e.type === 'error') return <div className="text-[12.5px] text-red-700 flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{e.text}</div>;
  if (e.type === 'done') return <div className="text-[12.5px] text-emerald-800 flex gap-1.5 font-semibold"><CheckCircle2 size={14} className="shrink-0 mt-0.5" />{e.text || 'تم'}</div>;
  return (
    <div className="text-[13px] font-semibold flex items-center gap-2">
      {last ? <Spinner size={13} className="text-gold-deep" /> : <CheckCircle2 size={13} className="text-gold-deep" />}{e.text}
      {e.variant && <span className="chip h-5 bg-ink/5 font-normal">خيار {e.variant}</span>}
    </div>
  );
}

function VerdictModal({ kind, onClose, onSubmit }: { kind: null | 'approved' | 'rejected'; onClose: () => void; onSubmit: (note: string, toTaste: boolean) => void }) {
  const [note, setNote] = useState(''); const [toTaste, setToTaste] = useState(true);
  useEffect(() => { setNote(''); setToTaste(true); }, [kind]);
  return (
    <Modal open={!!kind} onClose={onClose} title={kind === 'approved' ? 'اعتماد التصميم' : 'رفض التصميم'}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className={kind === 'approved' ? 'btn bg-emerald-700 text-white hover:bg-emerald-800' : 'btn-primary'} onClick={() => onSubmit(note.trim(), toTaste && !!note.trim())}>{kind === 'approved' ? 'اعتماد' : 'رفض'}</button></>}>
      <label className="label">{kind === 'approved' ? 'وش عجبك؟ (يتعلّم منه المصمم)' : 'وش السبب؟ (عشان ما يتكرر)'}</label>
      <textarea className="input min-h-[96px]" autoFocus value={note} onChange={e => setNote(e.target.value)}
        placeholder={kind === 'approved' ? 'مثال: الشعار بالوسط + الأصل كبير بدون تأثيرات' : 'مثال: الدوائر خلف الشخص مزعجة'} />
      <label className="flex items-center gap-2 mt-3 text-[13.5px] cursor-pointer">
        <input type="checkbox" checked={toTaste} onChange={e => setToTaste(e.target.checked)} className="accent-[#A29265] h-4 w-4" />
        <BookmarkPlus size={15} className="text-gold-deep" /> أضفها لسجل الذوق (تُطبَّق على كل التصاميم القادمة)
      </label>
    </Modal>
  );
}
