import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, Columns2, Rows3, Code2, Trash2, Maximize2, FileText, Images, Loader2, AlertTriangle, Info, CheckCircle2, Star } from 'lucide-react';
import { api, stream, postUrl, KINDS, STATES, themeOf, fmtDate, type Post, type Version, type QcSummary } from '../api';
import { SlideFrame, sizeOf, useWidth } from '../engine';
import { Spinner, useToast, Modal, Swatch, ScoreRing, Segmented } from '../ui';
import { AIPanel, type LogEv } from '../components/AIPanel';
import { ContentPanel, PhotosPanel } from '../components/SidePanels';

interface Prepared { spec: any; warnings: string[]; lint: { level: string; slide: number; msg: string }[] }

export default function PostPage({ pid, postId, health }: { pid: string; postId: string; health: any }) {
  const toast = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [viewId, setViewId] = useState<string | undefined>();
  const [tab, setTab] = useState<'content' | 'photos'>('content');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEv[]>([]);
  const [compare, setCompare] = useState<string[] | null>(null);
  const [json, setJson] = useState(false);
  const [exp, setExp] = useState(false);
  const [cap, setCap] = useState<null | { caption: string; hashtags: string[]; fixes: string[] }>(null);
  const url = postUrl(pid, postId);

  const load = useCallback(async () => {
    const p = await api.get<any>(`/api/projects/${pid}`);
    const found = (p.posts as Post[]).find(x => x.id === postId);
    if (!found) { toast('err', 'المنشور غير موجود'); return; }
    setPost(found);
    setViewId(v => (v && found.versions.some(x => x.id === v) ? v : found.current || found.versions[found.versions.length - 1]?.id));
  }, [pid, postId]);
  useEffect(() => { load().catch(e => toast('err', e.message)); }, [load]);

  const version = post?.versions.find(v => v.id === viewId);

  async function run(path: string, body: any, doneText: string) {
    setBusy(true); setLog([]);
    const push = (e: any) => setLog(l => [...l, { ...e, at: Date.now() }]);
    try {
      const r = await stream(url + path, body, ev => {
        if (['step', 'route', 'usage', 'review', 'log'].includes(ev.type)) push(ev);
        if (ev.type === 'qc') push({ type: 'qc', score: ev.score });
        if (ev.type === 'version') { setViewId(ev.version.id); load(); }
      });
      push({ type: 'done', text: doneText });
      await load();
      return r;
    } catch (e: any) { push({ type: 'error', text: e.message }); toast('err', e.message); }
    finally { setBusy(false); }
  }

  if (!post) return <div className="h-full grid place-items-center"><Spinner className="text-gold" size={22} /></div>;
  const th = themeOf(post.theme); const st = STATES[post.state];

  return (
    <div className="h-full flex flex-col">
      {/* الشريط العلوي */}
      <header className="h-[64px] shrink-0 border-b border-ink/10 bg-white/60 backdrop-blur flex items-center gap-3 px-4 lg:px-6">
        <a href={`#/p/${pid}`} className="btn-icon btn-ghost" title="رجوع"><ArrowRight size={18} /></a>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] text-ink-soft">
            <span className="font-bold text-ink">#{post.n}</span><span>{KINDS[post.kind]}</span><span>·</span><span>{fmtDate(post.publish)}</span>
            <span className="inline-flex items-center gap-1.5"><Swatch colors={th.colors} size={13} />{post.service}</span>
          </div>
          <div className="font-bold text-[16px] truncate">{post.title}</div>
        </div>
        <span className={`chip ${st.cls} hidden md:inline-flex`}>{st.label}</span>
        <div className="mr-auto flex items-center gap-2">
          {version && <button className="btn-ghost btn-sm hidden md:inline-flex" onClick={() => setJson(true)}><Code2 size={15} /> JSON</button>}
          <button className="btn-primary" disabled={!version || busy} onClick={() => setExp(true)}><Download size={16} /> إخراج نهائي {health?.exportScale || 3}×</button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* يمين: المحتوى والصور */}
        <aside className="w-[340px] xl:w-[360px] shrink-0 border-l border-ink/10 bg-white/35 flex flex-col">
          <div className="p-3 border-b border-ink/10">
            <Segmented value={tab} onChange={setTab} options={[{ v: 'content', label: <><FileText size={14} className="inline -mt-0.5 ml-1" />المحتوى</> },
              { v: 'photos', label: <><Images size={14} className="inline -mt-0.5 ml-1" />الصور ({post.photos.length})</> }]} />
          </div>
          <div className="flex-1 overflow-auto p-4">
            {tab === 'content' ? <ContentPanel pid={pid} post={post} onChange={setPost} /> : <PhotosPanel pid={pid} post={post} onChange={setPost} cutout={health?.cutout} />}
          </div>
        </aside>

        {/* الوسط: المسرح */}
        <section className="flex-1 min-w-0 flex flex-col">
          <VersionBar post={post} viewId={viewId} onView={setViewId} compare={compare} setCompare={setCompare}
            onDelete={async id => { if (!confirm('حذف هذه النسخة؟')) return; setPost(await api.del<Post>(`${url}/versions/${id}`)); }}
            onCurrent={async id => setPost(await api.post<Post>(`${url}/versions/${id}/current`))} />
          <div className="flex-1 min-h-0 overflow-auto">
            {compare && compare.length === 2
              ? <Compare pid={pid} post={post} ids={compare} />
              : <Stage key={viewId || 'draft'} pid={pid} post={post} version={version} busy={busy} />}
          </div>
        </section>

        {/* يسار: المصمم الذكي */}
        <aside className="w-[360px] xl:w-[390px] shrink-0 border-r border-ink/10 bg-white/50">
          <AIPanel post={post} version={version} busy={busy} log={log} aiReady={!!health?.aiReady}
            onDesign={d => run('/design', { direction: d }, 'جاهز — راجع التصميم')}
            onRevise={fb => { setPost({ ...post, chat: [...post.chat, { id: 'tmp', role: 'user', text: fb, at: '' }] }); run('/revise', { feedback: fb, versionId: viewId }, 'تم التعديل'); }}
            onVariants={n => run('/variants', { count: n }, 'الخيارات جاهزة — قارن بينها').then(r => setCompare(Array.isArray(r) && r.length >= 2 ? r.slice(0, 2).map((v: Version) => v.id) : null))}
            onCaption={async () => { const r = await run('/caption', {}, 'تم تدقيق الكابشن'); if (r) setCap(r); }}
            onVerdict={async (v, note, toTaste) => {
              if (!version) return;
              setPost(await api.post<Post>(`${url}/versions/${version.id}/verdict`, { verdict: v, note, toTaste }));
              toast('ok', v === 'approved' ? 'اعتُمد التصميم' + (toTaste ? ' وانحفظ بسجل الذوق' : '') : 'تم تسجيل الرفض' + (toTaste ? ' بسجل الذوق' : ''));
            }} />
        </aside>
      </div>

      {version && <ExportModal open={exp} onClose={() => setExp(false)} pid={pid} post={post} version={version} />}
      {version && <JsonEditor open={json} onClose={() => setJson(false)} pid={pid} post={post} version={version}
        onSave={(spec, label) => { setJson(false); run('/manual', { spec, label }, 'انرسمت النسخة اليدوية'); }} />}
      <Modal open={!!cap} onClose={() => setCap(null)} title="تدقيق الكابشن" wide
        footer={<><button className="btn-ghost" onClick={() => setCap(null)}>إغلاق</button>
          <button className="btn-primary" disabled={!version} onClick={async () => { setPost(await api.patch<Post>(`${url}/versions/${version!.id}`, { caption: cap!.caption, hashtags: cap!.hashtags })); setCap(null); toast('ok', 'تم تحديث الكابشن بالنسخة'); }}>اعتمد التصحيح</button></>}>
        {cap && <>
          {cap.fixes.length ? <ul className="mb-3 space-y-1">{cap.fixes.map((f, i) => <li key={i} className="text-[13px] text-gold-deep">• {f}</li>)}</ul> : <div className="text-[13px] text-emerald-800 mb-3">ما فيه أخطاء إملائية</div>}
          <div className="whitespace-pre-wrap leading-[1.9] text-[14.5px] bg-white rounded-xl p-4 border border-ink/10">{cap.caption}</div>
          <div className="mt-2 text-[13px] text-ink-soft" dir="rtl">{cap.hashtags.join(' ')}</div>
        </>}
      </Modal>
    </div>
  );
}

/* ── شريط النسخ ── */
function VersionBar({ post, viewId, onView, compare, setCompare, onDelete, onCurrent }: {
  post: Post; viewId?: string; onView: (id: string) => void; compare: string[] | null; setCompare: (c: string[] | null) => void;
  onDelete: (id: string) => void; onCurrent: (id: string) => void;
}) {
  if (!post.versions.length) return null;
  const pick = (id: string) => {
    if (!compare) return onView(id);
    const c = compare.includes(id) ? compare.filter(x => x !== id) : [...compare, id].slice(-2);
    setCompare(c);
  };
  return (
    <div className="shrink-0 border-b border-ink/10 bg-white/40 px-4 h-[54px] flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto py-2">
        {[...post.versions].reverse().map(v => {
          const on = compare ? compare.includes(v.id) : v.id === viewId;
          return (
            <button key={v.id} onClick={() => pick(v.id)} title={v.label || ''}
              className={`group shrink-0 inline-flex items-center gap-1.5 h-8 rounded-lg px-2.5 text-[12.5px] font-semibold border transition ${on ? 'bg-graphite text-ivory border-graphite' : 'bg-white/70 border-ink/10 hover:border-gold/50'}`}>
              {v.id === post.current && <Star size={11} className={on ? 'text-gold-light' : 'text-gold-deep'} fill="currentColor" />}
              v{v.n}
              {v.source === 'variant' && <span className="opacity-60 font-normal">بديل</span>}
              {v.source === 'manual' && <span className="opacity-60 font-normal">يدوي</span>}
              {v.qc && <span className={`h-1.5 w-1.5 rounded-full ${v.qc.errors.length ? 'bg-red-500' : v.qc.score >= 95 ? 'bg-emerald-500' : 'bg-gold'}`} />}
              {v.verdict === 'approved' && <CheckCircle2 size={12} className="text-emerald-500" />}
            </button>
          );
        })}
      </div>
      {post.versions.length > 1 && (
        <button className={`btn-sm ${compare ? 'btn-gold' : 'btn-line'}`} onClick={() => setCompare(compare ? null : [post.versions[post.versions.length - 1].id, post.versions[post.versions.length - 2].id])}>
          <Columns2 size={14} /> {compare ? `مقارنة (${compare.length}/2)` : 'قارن'}
        </button>
      )}
      {viewId && !compare && <>
        {viewId !== post.current && <button className="btn-line btn-sm" onClick={() => onCurrent(viewId)}><Star size={13} /> اجعلها الحالية</button>}
        <button className="btn-icon btn-ghost text-ink-mute hover:text-red-700" title="حذف النسخة" onClick={() => onDelete(viewId)}><Trash2 size={15} /></button>
      </>}
    </div>
  );
}

/* ── تجهيز spec (صور + preset) للمعاينة الحية ── */
function usePrepared(pid: string, postId: string, spec: any) {
  const [p, setP] = useState<Prepared | null>(null); const [err, setErr] = useState('');
  const key = useMemo(() => JSON.stringify(spec), [spec]);
  useEffect(() => {
    if (!spec) return; let off = false; setErr('');
    api.post<Prepared>(postUrl(pid, postId) + '/prepare', { spec }).then(r => !off && setP(r)).catch(e => !off && setErr(e.message));
    return () => { off = true; };
  }, [key]);   // eslint-disable-line
  return { prepared: p, err };
}

function Stage({ pid, post, version, busy }: { pid: string; post: Post; version?: Version; busy: boolean }) {
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => { if (!version) api.get(postUrl(pid, post.id) + '/draft').then(setDraft).catch(() => {}); }, [version?.id]);
  const spec = version?.spec || draft;
  const { prepared, err } = usePrepared(pid, post.id, spec);
  const [mode, setMode] = useState<'row' | 'grid'>('row');
  const [zoom, setZoom] = useState<number | null>(null);
  const [live, setLive] = useState<Record<number, { errors: string[]; warnings: string[] }>>({});
  const [box, width] = useWidth<HTMLDivElement>();
  const n = prepared?.spec?.slides?.length || 0;
  const [W, H] = sizeOf(prepared?.spec);
  const avail = Math.max(240, width);
  const single = n <= 1;
  const slideW = single ? Math.min(avail * 0.9, 560 * (W / H > 0.79 ? 1 : 0.85)) : mode === 'grid' ? Math.min(300, (avail - 24 * 3) / 3) : Math.min(380, avail * 0.42);

  return (
    <div className="p-5 lg:p-7" ref={box}>
      {!version && (
        <div className="mb-4 flex items-center gap-2 text-[13px] text-ink-soft bg-white/60 border border-ink/10 rounded-xl px-4 py-2.5">
          <Info size={15} className="text-gold-deep" /> مسودة آلية من التقويم (تقسيم الشرائح فقط) — اضغط «صمّم الآن» عشان يشتغل عليها المصمم.
        </div>
      )}
      {busy && <div className="mb-4 flex items-center gap-2 text-[13px] text-gold-deep"><Loader2 size={15} className="animate-spin" /> المصمم يشتغل… المعاينة تتحدث أول ما تجهز النسخة.</div>}
      {err && <div className="mb-4 text-[13px] text-red-700 bg-red-50 rounded-xl px-4 py-2.5">{err}</div>}
      {!prepared ? <div className="h-[60vh] grid place-items-center"><Spinner className="text-gold" size={22} /></div> : (
        <>
          {n > 1 && (
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[13px] text-ink-soft">{n} شرائح</span>
              <Segmented value={mode} onChange={setMode} options={[{ v: 'row', label: <Rows3 size={15} /> }, { v: 'grid', label: <Columns2 size={15} /> }]} />
            </div>
          )}
          <div className={single ? 'flex justify-center' : mode === 'row' ? 'flex gap-0 overflow-x-auto pb-4 snap-x' : 'grid gap-6'}
            style={mode === 'grid' && !single ? { gridTemplateColumns: `repeat(auto-fill, ${slideW}px)` } : undefined}>
            {prepared.spec.slides.map((_: any, i: number) => (
              <div key={i} className={`group relative shrink-0 snap-start ${!single && mode === 'row' ? 'first:rounded-r-[10px] last:rounded-l-[10px] overflow-hidden' : ''}`}>
                <SlideFrame spec={prepared.spec} index={i} width={slideW} className={!single && mode === 'row' ? '!rounded-none' : 'shadow-lift'}
                  onQC={q => setLive(l => ({ ...l, [i]: q }))} />
                <button onClick={() => setZoom(i)} className="absolute top-2 left-2 h-8 w-8 rounded-lg bg-black/45 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition"><Maximize2 size={15} /></button>
                {n > 1 && <span className="absolute bottom-2 left-2 chip bg-black/45 text-white">{i + 1}</span>}
                {(live[i]?.errors?.length || 0) > 0 && <span className="absolute top-2 right-2 chip bg-red-600 text-white"><AlertTriangle size={11} />{live[i].errors.length}</span>}
              </div>
            ))}
          </div>
          <QCPanel qc={version?.qc} live={live} prepared={prepared} />
        </>
      )}
      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={`الشريحة ${zoom !== null ? zoom + 1 : ''}`} wide="xl">
        {zoom !== null && prepared && (
          <div className="flex items-center justify-center gap-3">
            <button className="btn-line" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>السابقة</button>
            <SlideFrame spec={prepared.spec} index={zoom} width={Math.min(720, (window.innerHeight * 0.78 * W) / H)} />
            <button className="btn-line" disabled={zoom >= n - 1} onClick={() => setZoom(zoom + 1)}>التالية</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function QCPanel({ qc, live, prepared }: { qc?: QcSummary; live: Record<number, { errors: string[]; warnings: string[] }>; prepared: Prepared }) {
  const liveErr = Object.entries(live).flatMap(([i, q]) => (q.errors || []).map(e => `#${+i + 1}: ${e}`));
  const liveWarn = Object.entries(live).flatMap(([i, q]) => (q.warnings || []).map(e => `#${+i + 1}: ${e}`));
  const lint = prepared.lint.filter(l => l.level !== 'info');
  const score = qc?.score ?? Math.max(0, 100 - 15 * liveErr.length - 3 * liveWarn.length);
  const items = [
    ...liveErr.map(t => ({ k: 'err', t })), ...lint.filter(l => l.level === 'error').map(l => ({ k: 'err', t: `إملاء #${l.slide}: ${l.msg}` })),
    ...liveWarn.map(t => ({ k: 'warn', t })), ...lint.filter(l => l.level === 'warn').map(l => ({ k: 'warn', t: `#${l.slide}: ${l.msg}` })),
    ...prepared.warnings.map(t => ({ k: 'warn', t })),
  ];
  return (
    <div className="card mt-6 p-4 flex gap-4 items-start">
      <ScoreRing score={score} />
      <div className="min-w-0 flex-1">
        <div className="font-bold text-[14px]">الفحص الآلي {items.length === 0 && <span className="text-emerald-700 font-semibold">— سليم ✓</span>}</div>
        <div className="text-[12px] text-ink-mute mb-1.5">التداخل والحواف والتباين والإملاء وقائمة المرفوض — وبعدها افحص بعينك</div>
        <ul className="space-y-1 max-h-40 overflow-auto">
          {items.map((x, i) => (
            <li key={i} className={`text-[12.5px] flex gap-1.5 ${x.k === 'err' ? 'text-red-700' : 'text-[#8a5a00]'}`}>
              {x.k === 'err' ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <Info size={13} className="shrink-0 mt-0.5" />}{x.t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── مقارنة نسختين جنب بعض ── */
function Compare({ pid, post, ids }: { pid: string; post: Post; ids: string[] }) {
  const vs = ids.map(id => post.versions.find(v => v.id === id)!).filter(Boolean);
  const [box, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={box} className="p-5 lg:p-7 grid grid-cols-2 gap-6">
      {vs.map(v => <CompareCol key={v.id} pid={pid} post={post} v={v} width={(width - 24) / 2 - 8} />)}
    </div>
  );
}
function CompareCol({ pid, post, v, width }: { pid: string; post: Post; v: Version; width: number }) {
  const { prepared } = usePrepared(pid, post.id, v.spec);
  const n = prepared?.spec?.slides?.length || 0;
  const w = n > 1 ? Math.max(120, (width - 8) / Math.min(n, 3)) : Math.min(width, 460);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="chip bg-graphite text-ivory">v{v.n}</span><span className="text-[12.5px] text-ink-soft truncate">{v.label}</span>
        {v.qc && <span className="mr-auto text-[12px] text-ink-mute">الفحص {v.qc.score}</span>}
      </div>
      {v.concept && <p className="text-[12.5px] text-ink-soft mb-3 leading-relaxed line-clamp-3">{v.concept}</p>}
      {!prepared ? <Spinner className="text-gold" /> :
        <div className="flex flex-wrap gap-2">{prepared.spec.slides.map((_: any, i: number) => <SlideFrame key={i} spec={prepared.spec} index={i} width={w} className="shadow-card" />)}</div>}
    </div>
  );
}

/* ── الإخراج النهائي ── */
function ExportModal({ open, onClose, pid, post, version }: { open: boolean; onClose: () => void; pid: string; post: Post; version: Version }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const toast = useToast();
  useEffect(() => { if (open) setRes(null); }, [open, version.id]);
  const go = async () => {
    setBusy(true);
    try { setRes(await api.post(postUrl(pid, post.id) + '/export', { versionId: version.id })); }
    catch (e: any) { toast('err', e.message); } finally { setBusy(false); }
  };
  const jpgs = (res?.urls || []).filter((u: string) => /_1080\.jpg$/.test(u));
  return (
    <Modal open={open} onClose={onClose} title={`الإخراج النهائي — v${version.n}`} wide>
      {!res ? (
        <div className="text-center py-6">
          <div className="text-[15px] leading-relaxed text-ink-soft max-w-md mx-auto">
            يرسم كل الشرائح بدقة <b className="text-ink">3×</b> (منشور 3240×4050) ويطلع: PNG كامل + JPG 2160 للرفع بجودة عالية + JPG 1080 — كلها جودة 97 بدون subsampling، مع ورقة معاينة وشريط الكاروسيل والكابشن.
          </div>
          {version.qc && version.qc.errors.length > 0 && <div className="mt-4 text-[13px] text-red-700 inline-flex items-center gap-1.5"><AlertTriangle size={14} /> فيه {version.qc.errors.length} أخطاء بالفحص — الأفضل تصلحها قبل التسليم</div>}
          <div className="mt-6"><button className="btn-gold h-11 px-6" onClick={go} disabled={busy}>{busy ? <><Spinner /> جاري الرسم بأعلى دقة…</> : <><Download size={17} /> ابدأ الإخراج</>}</button></div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <ScoreRing score={res.score} size={52} />
            <div className="flex-1">
              <div className="font-bold">{res.errors.length ? 'جاهز — مع ملاحظات' : 'جاهز للتسليم'}</div>
              <div className="text-[12.5px] text-ink-soft">{res.files.length} ملف · الفحص بعد الرسم بالدقة الكاملة (يشمل التباين الفعلي)</div>
            </div>
            <a className="btn-primary" href={`${postUrl(pid, post.id)}/exports/${res.id}/zip`}><Download size={16} /> تحميل ZIP</a>
          </div>
          {[...res.errors, ...res.warnings].length > 0 && (
            <ul className="mb-4 space-y-1 text-[12.5px]">{res.errors.map((e: string, i: number) => <li key={i} className="text-red-700">• {e}</li>)}{res.warnings.map((e: string, i: number) => <li key={'w' + i} className="text-[#8a5a00]">• {e}</li>)}</ul>
          )}
          <div className="flex gap-2 overflow-x-auto pb-2">{jpgs.map((u: string) => <a key={u} href={u.replace('_1080.jpg', '.png')} target="_blank" rel="noreferrer"><img src={u} className="h-56 rounded-lg shadow-card" alt="" /></a>)}</div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {res.urls.map((u: string, i: number) => <a key={u} href={u} target="_blank" rel="noreferrer" className="chip bg-white border border-ink/10 hover:border-gold" dir="ltr">{res.files[i]}</a>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── محرر JSON (متقدم) مع معاينة حية ── */
function JsonEditor({ open, onClose, pid, post, version, onSave }: { open: boolean; onClose: () => void; pid: string; post: Post; version: Version; onSave: (spec: any, label: string) => void }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [spec, setSpec] = useState<any>(null); const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) { setText(JSON.stringify(version.spec, null, 2)); setSpec(version.spec); setErr(''); setIdx(0); } }, [open, version.id]);
  useEffect(() => { const t = setTimeout(() => { try { setSpec(JSON.parse(text)); setErr(''); } catch (e: any) { setErr(e.message); } }, 500); return () => clearTimeout(t); }, [text]);
  const { prepared } = usePrepared(pid, post.id, open ? spec : null);
  const n = prepared?.spec?.slides?.length || 0;
  return (
    <Modal open={open} onClose={onClose} title={`تعديل يدوي — v${version.n}`} wide="xl"
      footer={<><span className="ml-auto text-[12px] text-red-700">{err}</span><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" disabled={!!err} onClick={() => onSave(spec, `تعديل يدوي على v${version.n}`)}>احفظ كنسخة جديدة</button></>}>
      <div className="grid lg:grid-cols-[1fr_auto] gap-4">
        <textarea dir="ltr" spellCheck={false} className="input font-mono text-[12.5px] leading-relaxed h-[66vh] whitespace-pre" value={text} onChange={e => setText(e.target.value)} />
        <div className="flex flex-col items-center gap-2">
          {prepared ? <SlideFrame spec={prepared.spec} index={Math.min(idx, n - 1)} width={360} /> : <div className="w-[360px] h-[450px] shimmer rounded-xl" />}
          {n > 1 && <div className="flex gap-1">{Array.from({ length: n }, (_, i) => <button key={i} className={`h-7 w-7 rounded-md text-[12px] ${i === idx ? 'bg-graphite text-ivory' : 'bg-white border border-ink/10'}`} onClick={() => setIdx(i)}>{i + 1}</button>)}</div>}
        </div>
      </div>
    </Modal>
  );
}
