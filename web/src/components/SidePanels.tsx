import { useRef, useState } from 'react';
import { UploadCloud, Trash2, AlertTriangle, Scissors, Layers, Wand2 } from 'lucide-react';
import { api, postUrl, THEMES, KINDS, type Post, type Photo } from '../api';
import { Spinner, useToast, Swatch } from '../ui';

export function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = THEMES.find(t => t.id === value);
  return (
    <div className="relative">
      <button type="button" className="input flex items-center gap-2.5 text-right" onClick={() => setOpen(o => !o)}>
        <Swatch colors={cur?.colors || ['#ccc', '#999']} /><span className="truncate">{cur?.name || value}</span><span className="mr-auto text-ink-mute text-xs">{value}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 w-full card bg-white p-1.5 max-h-80 overflow-auto fade-in">
            {(['svc', 'brand', 'other'] as const).map(g => (
              <div key={g}>
                <div className="px-2.5 pt-2 pb-1 text-[11px] font-bold text-ink-mute">{g === 'svc' ? 'ألوان الخدمات (دليل الهوية)' : g === 'brand' ? 'العلامة الأم' : 'ثيمات أخرى'}</div>
                {THEMES.filter(t => t.group === g).map(t => (
                  <button key={t.id} type="button" onClick={() => { onChange(t.id); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[14px] hover:bg-ivory ${t.id === value ? 'bg-ivory font-bold' : ''}`}>
                    <Swatch colors={t.colors} /> {t.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ContentPanel({ pid, post, onChange }: { pid: string; post: Post; onChange: (p: Post) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Post>>({});
  const val = (k: keyof Post) => (draft[k] ?? post[k]) as string;
  const set = (k: keyof Post) => (e: any) => setDraft(d => ({ ...d, [k]: e.target.value }));
  const save = async (patch: Partial<Post> = draft) => {
    if (!Object.keys(patch).length) return;
    try { const p = await api.patch<Post>(postUrl(pid, post.id), patch); onChange(p); setDraft({}); } catch (e: any) { toast('err', e.message); }
  };
  const blur = () => save();
  return (
    <div className="space-y-4">
      <div><label className="label">العنوان</label><input className="input" value={val('title')} onChange={set('title')} onBlur={blur} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">النوع</label>
          <select className="input" value={val('kind')} onChange={e => save({ kind: e.target.value as Post['kind'] })}>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="label">النشر</label><input className="input" value={val('publish')} onChange={set('publish')} onBlur={blur} placeholder="YYYY-MM-DD" /></div>
      </div>
      <div><label className="label">الخدمة / اللون</label><ThemePicker value={val('theme')} onChange={v => save({ theme: v })} /></div>
      <div>
        <label className="label flex items-center justify-between">المحتوى للتصميم <span className="text-[11px] font-normal text-ink-mute">يُستخدم حرفياً</span></label>
        <textarea className="input min-h-[180px] leading-[1.9] text-[14px]" value={val('design')} onChange={set('design')} onBlur={blur} />
      </div>
      <div><label className="label">ملاحظات للمصمم</label><textarea className="input min-h-[70px] text-[14px]" value={val('notes')} onChange={set('notes')} onBlur={blur} placeholder="تُطبَّق حرفياً بالتصميم" /></div>
      <div><label className="label">الكابشن</label><textarea className="input min-h-[150px] leading-[1.9] text-[14px]" value={val('caption')} onChange={set('caption')} onBlur={blur} /></div>
      <div className="text-[12px] text-ink-mute grid grid-cols-2 gap-y-1">
        <span>المنصة: {post.platform || '—'}</span><span>المحور: {post.pillar || '—'}</span>
        <span>التسليم: {post.due || '—'}</span><span>النوع بالتقويم: {post.ctype || '—'}</span>
      </div>
    </div>
  );
}

export function PhotosPanel({ pid, post, onChange, cutout, direct, onGenerate, onEditAsset }: { pid: string; post: Post; onChange: (p: Post) => void; cutout?: boolean; direct?: boolean; onGenerate: () => void; onEditAsset: (p: Photo) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let r: { post: Post; warnings: string[] };
      if (direct) {   // على Vercel: رفع مباشر للتخزين (بدون حد 4.5MB وبدقة الأصل) ثم تسجيل
        const { upload } = await import('@vercel/blob/client');
        const items: { pathname: string; name: string }[] = [];
        for (const f of Array.from(files)) {
          const ext = (f.name.match(/\.(png|jpe?g|webp|avif|heic|heif|tiff?)$/i)?.[1] || 'jpg').toLowerCase();
          const pathname = `uploads/${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}.${ext}`;
          await upload(pathname, f, { access: 'private', handleUploadUrl: '/api/blob/upload', multipart: f.size > 8 * 1024 * 1024 } as any);
          items.push({ pathname, name: f.name });
        }
        r = await api.post(postUrl(pid, post.id) + '/photos/register', { items });
      } else {
        const fd = new FormData(); for (const f of Array.from(files)) fd.append('photos', f);
        r = await api.post(postUrl(pid, post.id) + '/photos', fd);
      }
      onChange(r.post); r.warnings.forEach(w => toast('info', w));
    } catch (e: any) { toast('err', e.message); } finally { setBusy(false); }
  }
  const src = (file: string) => `/files/projects/${pid}/posts/${post.id}/photos/${file}`;
  return (
    <div className="space-y-3">
      <div onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition ${drag ? 'border-gold bg-gold/5' : 'border-ink/15 hover:border-gold/60 bg-white/50'}`}>
        {busy ? <Spinner className="mx-auto text-gold" size={22} /> : <UploadCloud className="mx-auto text-gold-deep" size={26} strokeWidth={1.6} />}
        <div className="font-semibold text-[14px] mt-2">ارفع الأصول والصور</div>
        <div className="text-[12px] text-ink-mute mt-1 leading-relaxed">PNG مقصوص (شفاف) للأصول · صور حقيقية بأعلى دقة<br />أو ولّد العنصر بـ GPT Image من الزر تحت</div>
        <input ref={input} type="file" multiple accept="image/*" hidden onChange={e => upload(e.target.files)} />
      </div>
      <button className="btn-line w-full" onClick={onGenerate}><Wand2 size={15} className="text-gold-deep" /> ولّد عنصر أو صورة بـ GPT Image</button>
      {!cutout && <div className="flex gap-2 text-[12px] text-ink-soft bg-ivory-2 rounded-xl p-3 leading-relaxed"><Scissors size={14} className="shrink-0 mt-0.5" />قص الخلفية التلقائي غير مفعّل على السيرفر — ارفع الأشخاص/الأصول PNG مقصوصة.</div>}
      <div className="grid grid-cols-2 gap-2.5">
        {post.photos.map(ph => (
          <div key={ph.id} className="group rounded-xl overflow-hidden border border-ink/10 bg-white">
            <div className={`relative aspect-square ${ph.alpha ? 'checker' : 'bg-ivory-2'}`}>
              <img src={src(ph.file)} alt="" className={`w-full h-full ${ph.alpha ? 'object-contain p-2' : 'object-cover'}`} loading="lazy" />
              <span className={`chip absolute top-1.5 right-1.5 ${ph.alpha ? 'bg-emerald-700/85 text-white' : 'bg-graphite/75 text-ivory'}`}>{ph.alpha ? <><Layers size={11} />مقصوص</> : 'صورة'}</span>
              {ph.source === 'code-drawn' && <span className="chip absolute top-1.5 left-9 bg-ink text-white" title={ph.asset?.description}><Wand2 size={11} />مرسوم{ph.asset?.rev && ph.asset.rev > 1 ? ` r${ph.asset.rev}` : ''}</span>}
              {ph.source === 'gpt-image' && <span className="chip absolute top-1.5 left-9 bg-gold text-white" title={ph.prompt}><Wand2 size={11} />مولّد{ph.asset?.rev && ph.asset.rev > 1 ? ` r${ph.asset.rev}` : ''}</span>}
              <button className="absolute bottom-1.5 left-1.5 h-7 px-2 rounded-lg bg-graphite/85 text-ivory text-[11.5px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition"
                onClick={() => onEditAsset(ph)} title="عدّل نفس الصورة بكلامك"><Wand2 size={12} /> عدّل</button>
              {Math.max(ph.w, ph.h) < 1600 && <span className="chip absolute bottom-1.5 right-1.5 bg-sun text-graphite" title="دقة منخفضة"><AlertTriangle size={11} />{ph.w}px</span>}
              <button className="absolute top-1.5 left-1.5 h-7 w-7 rounded-lg bg-white/90 text-red-700 grid place-items-center opacity-0 group-hover:opacity-100 transition"
                onClick={async () => { if (!confirm('حذف الصورة؟')) return; onChange(await api.del<Post>(`${postUrl(pid, post.id)}/photos/${ph.id}`)); }}><Trash2 size={14} /></button>
            </div>
            <div className="p-2">
              <div className="text-[11px] text-ink-mute truncate" title={ph.name}>{ph.name} · {ph.w}×{ph.h}</div>
              <input className="w-full mt-1 text-[12px] bg-transparent outline-none border-b border-transparent focus:border-gold placeholder:text-ink-mute/70" defaultValue={ph.note || ''}
                placeholder="وصف/استخدام (اختياري)" onBlur={e => e.target.value !== (ph.note || '') && api.patch(`${postUrl(pid, post.id)}/photos/${ph.id}`, { note: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
