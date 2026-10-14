import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Sparkles, CalendarDays, Image as ImageIcon, CheckSquare, Square, Pencil, StopCircle } from 'lucide-react';
import { api, stream, postUrl, themeOf, KINDS, STATES, fmtDate, THEMES, type Project, type Post } from '../api';
import { go } from '../App';
import { Spinner, useToast, Modal, Swatch, Segmented, Empty } from '../ui';

type Filter = 'all' | Post['state'];

export default function ProjectPage({ pid }: { pid: string }) {
  const [p, setP] = useState<Project | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ i: number; n: number; title: string; step: string } | null>(null);
  const [stop, setStop] = useState<AbortController | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [rename, setRename] = useState(false);
  const toast = useToast();
  const load = () => api.get<Project>(`/api/projects/${pid}`).then(setP).catch(e => toast('err', e.message));
  useEffect(() => { load(); }, [pid]);

  const posts = useMemo(() => (p?.posts || []).filter(x => filter === 'all' || x.state === filter), [p, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: p?.posts.length || 0 };
    for (const x of p?.posts || []) c[x.state] = (c[x.state] || 0) + 1; return c;
  }, [p]);

  async function runBatch() {
    const list = (p?.posts || []).filter(x => sel.has(x.id));
    const ac = new AbortController(); setStop(ac);
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (ac.signal.aborted) break;
      const post = list[i];
      setBatch({ i: i + 1, n: list.length, title: post.title, step: 'بدء…' });
      try {
        await stream(postUrl(pid, post.id) + '/design', {}, ev => { if (ev.type === 'step') setBatch(b => b && { ...b, step: ev.text }); }, ac.signal);
        ok++;
      } catch (e: any) { if (!ac.signal.aborted) toast('err', `#${post.n}: ${e.message}`); }
      load();
    }
    setBatch(null); setStop(null); setSel(new Set());
    if (ok) toast('ok', `تم تصميم ${ok} منشور — راجعها واعتمدها`);
  }

  if (!p) return <div className="h-full grid place-items-center"><Spinner className="text-gold" size={22} /></div>;
  const allSel = posts.length > 0 && posts.every(x => sel.has(x.id));

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-8">
      <a href="#/" className="inline-flex items-center gap-1.5 text-ink-soft hover:text-ink text-sm mb-3"><ArrowRight size={15} /> الخطط</a>
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-bold text-graphite flex items-center gap-2">{p.name}
            <button className="btn-icon btn-ghost text-ink-mute" onClick={() => setRename(true)}><Pencil size={15} /></button></h1>
          {p.source && <div className="text-ink-mute text-[13px]">من الملف: {p.source}</div>}
        </div>
        <div className="mr-auto flex items-center gap-2">
          <button className="btn-line" onClick={() => setNewOpen(true)}><Plus size={16} /> منشور</button>
          <button className="btn-gold" disabled={!sel.size || !!batch} onClick={runBatch}>
            <Sparkles size={16} /> صمّم المحدد {sel.size ? `(${sel.size})` : ''}
          </button>
        </div>
      </header>

      {batch && (
        <div className="card p-4 mb-5 flex items-center gap-4 fade-in border-gold/30">
          <Spinner className="text-gold-deep" size={20} />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[14px] truncate">({batch.i}/{batch.n}) {batch.title}</div>
            <div className="text-ink-soft text-[13px]">{batch.step}</div>
          </div>
          <div className="w-40 h-1.5 rounded-full bg-ink/10 overflow-hidden"><div className="h-full bg-gold transition-all" style={{ width: `${((batch.i - 1) / batch.n) * 100}%` }} /></div>
          <button className="btn-ghost btn-sm text-red-700" onClick={() => stop?.abort()}><StopCircle size={15} /> إيقاف</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { v: 'all', label: `الكل ${counts.all}` }, { v: 'new', label: `جديد ${counts.new || 0}` },
          { v: 'review', label: `بانتظار الاعتماد ${counts.review || 0}` }, { v: 'approved', label: `معتمد ${counts.approved || 0}` },
        ]} />
        <button className="btn-ghost btn-sm mr-auto" onClick={() => setSel(allSel ? new Set() : new Set(posts.map(x => x.id)))}>
          {allSel ? <CheckSquare size={15} /> : <Square size={15} />} تحديد الكل
        </button>
      </div>

      {!posts.length ? <div className="card"><Empty icon={<CalendarDays />} title="ما فيه منشورات هنا" action={<button className="btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> أضف منشور</button>} /></div> :
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {posts.map(post => <PostCard key={post.id} pid={pid} post={post} selected={sel.has(post.id)}
            onSelect={() => setSel(s => { const n = new Set(s); n.has(post.id) ? n.delete(post.id) : n.add(post.id); return n; })} />)}
        </div>}

      <NewPost open={newOpen} onClose={() => setNewOpen(false)} pid={pid} />
      <Modal open={rename} onClose={() => setRename(false)} title="اسم المشروع"
        footer={<button className="btn-primary" onClick={async () => { await api.patch(`/api/projects/${pid}`, { name: p.name }); setRename(false); }}>حفظ</button>}>
        <input className="input" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} />
      </Modal>
    </div>
  );
}

function PostCard({ pid, post, selected, onSelect }: { pid: string; post: Post; selected: boolean; onSelect: () => void }) {
  const v = post.versions.find(x => x.id === post.current) || post.versions[post.versions.length - 1];
  const th = themeOf(post.theme); const st = STATES[post.state];
  return (
    <div className={`card group overflow-hidden flex flex-col transition-all hover:shadow-lift ${selected ? 'ring-2 ring-gold' : ''}`}>
      <a href={`#/p/${pid}/${post.id}`} className="relative block aspect-[4/5] bg-ivory-2 overflow-hidden">
        {v?.preview ? <img src={v.preview} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" loading="lazy" />
          : <div className="absolute inset-0 grid place-items-center" style={{ background: `linear-gradient(160deg, ${th.colors[0]}, ${th.colors[1]})` }}>
              <div className="text-center px-6">
                <img src="/symbol-gold.svg" className="h-10 mx-auto opacity-60 mb-3" alt="" />
                <div className="font-display font-bold text-[17px] leading-snug text-graphite/80 line-clamp-4">{post.title}</div>
              </div>
            </div>}
        <span className={`chip absolute top-3 right-3 ${st.cls} backdrop-blur bg-opacity-90`}>{post.state === 'designing' && <span className="h-1.5 w-1.5 rounded-full bg-current pulse-dot" />}{st.label}</span>
        {post.versions.length > 0 && <span className="chip absolute top-3 left-3 bg-graphite/80 text-ivory">v{v?.n}{post.versions.length > 1 ? ` من ${post.versions.length}` : ''}</span>}
      </a>
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[12px] text-ink-soft">
          <span className="font-bold text-ink">#{post.n}</span>
          <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{fmtDate(post.publish)}</span>
          <span>·</span><span>{KINDS[post.kind] || post.kind}</span>
          {post.photos.length > 0 && <span className="inline-flex items-center gap-1 mr-auto"><ImageIcon size={13} />{post.photos.length}</span>}
        </div>
        <a href={`#/p/${pid}/${post.id}`} className="font-bold text-[15px] leading-snug mt-2 line-clamp-2 hover:text-gold-deep">{post.title}</a>
        <div className="flex items-center gap-2 mt-auto pt-3">
          <Swatch colors={th.colors} size={16} /><span className="text-[12px] text-ink-soft truncate">{post.service}</span>
          <button onClick={onSelect} className={`mr-auto h-7 w-7 rounded-lg grid place-items-center transition ${selected ? 'bg-gold text-white' : 'text-ink-mute hover:bg-ink/5'}`} title="تحديد للتصميم الجماعي">
            {selected ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewPost({ open, onClose, pid }: { open: boolean; onClose: () => void; pid: string }) {
  const [f, setF] = useState({ title: '', ctype: 'Single Image', design: '', caption: '', notes: '', publish: '', theme: '' });
  const toast = useToast();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="منشور جديد" wide
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" disabled={!f.title.trim() || !f.design.trim()} onClick={async () => {
          try { const post = await api.post<Post>(`/api/projects/${pid}/posts`, { ...f, theme: f.theme || undefined }); go(`/p/${pid}/${post.id}`); }
          catch (e: any) { toast('err', e.message); }
        }}>إنشاء وفتح</button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><label className="label">العنوان</label><input className="input" value={f.title} onChange={set('title')} /></div>
        <div><label className="label">النوع</label>
          <select className="input" value={f.ctype} onChange={set('ctype')}>
            <option value="Single Image">منشور مفرد</option><option value="Carousel">كاروسيل</option><option value="Story">ستوري</option><option value="Reel">غلاف ريل</option>
          </select></div>
        <div><label className="label">تاريخ النشر</label><input type="date" className="input" value={f.publish} onChange={set('publish')} /></div>
        <div className="sm:col-span-2"><label className="label">المحتوى للتصميم (حرفي — للكاروسيل: «الشريحة 1 … الشريحة 2 …»)</label>
          <textarea className="input min-h-[140px] leading-relaxed" value={f.design} onChange={set('design')} /></div>
        <div className="sm:col-span-2"><label className="label">الكابشن</label><textarea className="input min-h-[90px]" value={f.caption} onChange={set('caption')} /></div>
        <div><label className="label">الخدمة / اللون (فاضي = تلقائي)</label>
          <select className="input" value={f.theme} onChange={set('theme')}>
            <option value="">اكتشاف تلقائي من النص</option>
            {THEMES.filter(t => t.group !== 'other').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div><label className="label">ملاحظات للمصمم</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      </div>
    </Modal>
  );
}
