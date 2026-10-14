import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Cpu, Gauge, Zap, Eye, Crown, Save, CheckCircle2, XCircle, Scissors, Type, Wand2 } from 'lucide-react';
import { api, money } from '../api';
import { Spinner, useToast, Segmented, Toggle } from '../ui';

interface Settings {
  provider: 'radox' | 'anthropic'; radoxKey: string; radoxBaseUrl: string; anthropicKey: string;
  models: Record<'pro' | 'balanced' | 'fast' | 'vision', string>; routing: 'smart' | 'quality' | 'economy';
  reviewRounds: number; autoFix: boolean; monthlyBudget: number;
  imageModel: string; imageQuality: string; assetModel: string;
}
interface Model { id: string; name?: string; vision: boolean; reasoning: boolean; context?: number; inPer1k?: number; outPer1k?: number }

const TIERS = [
  { k: 'pro', icon: <Crown size={17} />, name: 'القوي', use: 'تصميم جديد من المحتوى · إعادة الفكرة بالكامل', hint: 'الأقوى بالإبداع وفهم القواعد' },
  { k: 'balanced', icon: <Gauge size={17} />, name: 'المتوازن', use: 'خيارات بديلة · تعديلات متوسطة · إصلاح أخطاء الفحص', hint: 'جودة عالية بنصف التكلفة تقريباً' },
  { k: 'fast', icon: <Zap size={17} />, name: 'السريع', use: 'تعديلات صغيرة (حجم/لون/مكان) كـ patch · تدقيق الكابشن', hint: 'أرخص بكثير — يكفي للتعديلات الدقيقة' },
  { k: 'vision', icon: <Eye size={17} />, name: 'البصري', use: 'الفحص البصري للتصميم المرسوم (يشوف الصورة)', hint: 'لازم يدعم الصور' },
] as const;

function ImageTest() {
  const [busy, setBusy] = useState(false); const [r, setR] = useState<any>(null);
  return (
    <div className="mt-4 pt-4 border-t border-ink/[.07] flex flex-wrap items-start gap-4">
      <button className="btn-line" disabled={busy} onClick={async () => { setBusy(true); setR(null); try { setR(await api.post('/api/images/test')); } finally { setBusy(false); } }}>
        {busy ? <Spinner /> : <Wand2 size={15} />} اختبر رسم الصور عبر RadoxAI</button>
      <span className="text-[12px] text-ink-mute flex-1 min-w-[220px]">احفظ الإعدادات أولاً. يرسم صورة صغيرة رخيصة (1024، جودة low) ويعرض النتيجة أو الخطأ كما هو.</span>
      {r && (
        <div className={`w-full rounded-xl p-3 text-[13px] flex items-start gap-3 ${r.ok ? 'bg-emerald-600/10 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
          {r.image && <img src={r.image} className="h-24 w-24 rounded-lg object-cover" alt="" />}
          <div><b>{r.provider} · <span dir="ltr">{r.model}</span></b> — {r.message} <span className="text-ink-mute">({(r.ms / 1000).toFixed(1)}ث)</span></div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage({ health }: { health: any }) {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [models, setModels] = useState<{ list: Model[]; error?: string; tiers: Record<string, string> } | null>(null);
  const [loadingModels, setLM] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadModels = async (refresh = false) => { setLM(true); try { setModels(await api.get(`/api/models${refresh ? '?refresh=1' : ''}`)); } catch (e: any) { toast('err', e.message); } finally { setLM(false); } };
  useEffect(() => { api.get<Settings>('/api/settings').then(setS); loadModels(); }, []);
  if (!s) return <div className="h-full grid place-items-center"><Spinner className="text-gold" /></div>;
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });
  const save = async () => {
    setSaving(true);
    try { setS(await api.put<Settings>('/api/settings', s)); toast('ok', 'انحفظت الإعدادات'); loadModels(true); }
    catch (e: any) { toast('err', e.message); } finally { setSaving(false); }
  };
  const price = (id: string) => { const m = models?.list.find(x => x.id === id); return m?.inPer1k !== undefined ? `${money((m.inPer1k || 0) * 1000)} / ${money((m.outPer1k || 0) * 1000)} لكل مليون` : ''; };

  return (
    <div className="max-w-[980px] mx-auto px-6 lg:px-10 py-10 space-y-6">
      <div className="flex items-end justify-between">
        <div><h1 className="font-display text-[28px] font-bold text-graphite">الإعدادات والموديلات</h1>
          <p className="text-ink-soft mt-1">الربط بالـ API والتوجيه الذكي بين الموديلات لتوفير التوكن.</p></div>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner /> : <Save size={16} />} حفظ</button>
      </div>

      <section className="card p-6">
        <h2 className="font-bold text-[16px] flex items-center gap-2 mb-4"><KeyRound size={18} className="text-gold-deep" /> مزوّد الذكاء الاصطناعي</h2>
        <Segmented value={s.provider} onChange={v => set({ provider: v })} options={[{ v: 'radox', label: 'RadoxAI' }, { v: 'anthropic', label: 'Anthropic مباشرة' }]} />
        {s.provider === 'radox' ? (
          <div className="grid md:grid-cols-2 gap-4 mt-5">
            <div><label className="label">مفتاح RadoxAI</label><input className="input" dir="ltr" value={s.radoxKey} onChange={e => set({ radoxKey: e.target.value })} placeholder="cc_..." /></div>
            <div><label className="label">Base URL</label><input className="input" dir="ltr" value={s.radoxBaseUrl} onChange={e => set({ radoxBaseUrl: e.target.value })} /></div>
            <p className="md:col-span-2 text-[12.5px] text-ink-mute">يُفضّل وضع المفتاح بملف ‎.env على السيرفر (RADOX_API_KEY) — المفتاح ما يطلع للمتصفح أبداً.</p>
          </div>
        ) : (
          <div className="mt-5"><label className="label">مفتاح Anthropic</label><input className="input" dir="ltr" value={s.anthropicKey} onChange={e => set({ anthropicKey: e.target.value })} placeholder="sk-ant-..." />
            <p className="text-[12.5px] text-ink-mute mt-2">مع Anthropic المباشر تتكاش التعليمات الثابتة (دليل المهارة وسجل الذوق) — الطلبات المتكررة أرخص بحوالي 90% على الجزء المكاش.</p></div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-[16px] flex items-center gap-2"><Cpu size={18} className="text-gold-deep" /> التوجيه الذكي بين الموديلات</h2>
          <button className="btn-ghost btn-sm" onClick={() => loadModels(true)} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? 'animate-spin' : ''} /> تحديث القائمة</button>
        </div>
        <p className="text-[13px] text-ink-soft mb-4 leading-relaxed">كل طلب يروح لأرخص موديل يقدر يسويه صح: الموديل القوي للتصميم الجديد فقط، والتعديلات الصغيرة ترجع كـ patch صغير بالموديل السريع بدل إعادة كتابة التصميم كله، ولو فشل أي موديل (JSON غلط/أخطاء) يصعد تلقائياً للمستوى الأقوى. وكل نوع طلب ياخذ من دليل المهارة الجزء اللي يحتاجه فقط.</p>
        <Segmented value={s.routing} onChange={v => set({ routing: v })} options={[
          { v: 'smart', label: 'ذكي (موصى)' }, { v: 'economy', label: 'اقتصادي' }, { v: 'quality', label: 'أعلى جودة دايماً' }]} />
        <div className="text-[12.5px] text-ink-mute mt-2">
          {s.routing === 'smart' ? 'يوزّع حسب نوع الطلب كما بالجدول.' : s.routing === 'economy' ? 'يبدأ مستوى أقل من الجدول ويصعد فقط عند الفشل — أرخص، وممكن جودة أقل بالتصميم الجديد.' : 'كل الطلبات بالموديل القوي — أغلى.'}
        </div>
        {models?.error && <div className="mt-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-4 py-2.5">تعذّر جلب الموديلات: {models.error}</div>}
        <div className="mt-5 divide-y divide-ink/[.07] border border-ink/[.08] rounded-2xl overflow-hidden bg-white/60">
          {TIERS.map(t => (
            <div key={t.k} className="grid md:grid-cols-[1fr_320px] gap-3 p-4 items-center">
              <div className="flex gap-3">
                <span className="h-9 w-9 rounded-xl bg-graphite text-gold-light grid place-items-center shrink-0">{t.icon}</span>
                <div><div className="font-bold text-[14.5px]">{t.name} <span className="font-normal text-ink-mute text-[12px]">· {t.hint}</span></div>
                  <div className="text-[12.5px] text-ink-soft mt-0.5">{t.use}</div></div>
              </div>
              <div>
                <select className="input text-[13.5px]" dir="ltr" value={s.models[t.k]} onChange={e => set({ models: { ...s.models, [t.k]: e.target.value } })}>
                  <option value="">تلقائي{models?.tiers?.[t.k] ? ` → ${models.tiers[t.k]}` : ''}</option>
                  {(models?.list || []).filter(m => t.k !== 'vision' || m.vision).map(m => <option key={m.id} value={m.id}>{m.id}{m.vision ? ' 👁' : ''}</option>)}
                </select>
                <div className="text-[11px] text-ink-mute mt-1" dir="rtl">{price(s.models[t.k] || models?.tiers?.[t.k] || '')}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-bold text-[16px] flex items-center gap-2 mb-1"><Wand2 size={18} className="text-gold-deep" /> توليد العناصر والصور — GPT Image</h2>
        <p className="text-[13px] text-ink-soft mb-4 leading-relaxed">كل شي عبر RadoxAI بنفس المفتاح: موديل GPT يقرأ التصميم ويكتب البرومبت، والرسم بموديل الصور. الوصف يُكتب بالعربي ويتحول لبرومبت احترافي بأسلوب الهوية (بدون نصوص أو شعارات داخل الصورة). ⚠ حالياً RadoxAI ما فعّل توليد الصور على حسابك — جرّب بالزر تحت بعد ما يفعّلونه.</p>
        <div className="grid md:grid-cols-2 gap-4 mb-4 pb-4 border-b border-ink/[.07]">
          <div><label className="label">قراءة التصميم وكتابة البرومبتات (RadoxAI)</label>
            <select className="input text-[13.5px]" dir="ltr" value={s.assetModel} onChange={e => set({ assetModel: e.target.value })}>
              <option value="">تلقائي{models?.tiers?.asset ? ` → ${models.tiers.asset}` : ''}</option>
              {(models?.list || []).filter(m => m.vision).map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
            <p className="text-[12px] text-ink-mute mt-1.5">يقرأ التصميم ويقرر الأصل ويترجم تعديلاتك — الافتراضي GPT من RadoxAI</p></div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">الموديل</label>
            <input className="input" dir="ltr" list="img-models" value={s.imageModel} onChange={e => set({ imageModel: e.target.value })} />
            <datalist id="img-models"><option value="gpt-image-2.5-flare" /><option value="gpt-image-2.5-sunburst" /><option value="gpt-image-2" /></datalist>
            <p className="text-[12px] text-ink-mute mt-1.5">flare: سريع وجودة عالية لليومي · sunburst: أدق تفاصيل وأبطأ</p></div>
          <div><label className="label">الجودة الافتراضية</label>
            <select className="input" value={s.imageQuality} onChange={e => set({ imageQuality: e.target.value })}>
              {['low', 'medium', 'high', 'xhigh', 'max', 'auto'].map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            <p className="text-[12px] text-ink-mute mt-1.5">xhigh/max متاحة لموديلات 2.5 فقط — أغلى وأبطأ</p></div>
        </div>
        <ImageTest />
      </section>

      <section className="card p-6 grid md:grid-cols-3 gap-6">
        <div><label className="label">جولات الفحص البصري</label>
          <select className="input" value={s.reviewRounds} onChange={e => set({ reviewRounds: Number(e.target.value) })}>
            <option value={0}>بدون (أوفر)</option><option value={1}>جولة وحدة (موصى)</option><option value={2}>جولتين</option></select>
          <p className="text-[12px] text-ink-mute mt-1.5">يرسم التصميم ويرسله للموديل البصري يفحصه بعينه ويصلحه.</p></div>
        <div><label className="label">إصلاح أخطاء الفحص تلقائياً</label><Toggle on={s.autoFix} onChange={v => set({ autoFix: v })} label={s.autoFix ? 'مفعّل' : 'متوقف'} />
          <p className="text-[12px] text-ink-mute mt-1.5">لو المحرك لقى تداخل/نص طالع/إملاء — يصلحه بالموديل المتوازن.</p></div>
        <div><label className="label">حد التكلفة الشهري ($)</label><input type="number" min={0} className="input" value={s.monthlyBudget} onChange={e => set({ monthlyBudget: Number(e.target.value) })} />
          <p className="text-[12px] text-ink-mute mt-1.5">تنبيه بصفحة الاستهلاك لو تعدّاه (0 = بدون).</p></div>
      </section>

      {health && (
        <section className="card p-6">
          <h2 className="font-bold text-[16px] mb-4">حالة السيرفر</h2>
          <div className="grid sm:grid-cols-2 gap-3 text-[13.5px]">
            <Status ok={health.aiReady} label="مفتاح الذكاء الاصطناعي" />
            <Status ok={health.cutout} label="قص الخلفية التلقائي (Python + rembg)" icon={<Scissors size={14} />} />
            {Object.entries<boolean>(health.fonts || {}).map(([k, v]) => <Status key={k} ok={v} label={`خط ${({ expo: 'Expo Arabic', bahij: 'Bahij', thsans: 'ثمانية سانس', thserif: 'ثمانية سيرف', plex: 'IBM Plex', cairo: 'Cairo' } as any)[k] || k}`} icon={<Type size={14} />} hint={!v ? 'ضع ملفات الخط بـ engine/assets/fonts' : undefined} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Status({ ok, label, icon, hint }: { ok: boolean; label: string; icon?: any; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/70 border border-ink/[.07] px-3.5 h-11">
      {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <XCircle size={16} className="text-red-500" />}
      <span className="text-ink-mute">{icon}</span><span>{label}</span>
      {hint && <span className="mr-auto text-[11px] text-ink-mute">{hint}</span>}
    </div>
  );
}
