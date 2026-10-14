import { useEffect, useState } from 'react';
import { Save, BookHeart } from 'lucide-react';
import { api } from '../api';
import { Spinner, useToast } from '../ui';

export default function TastePage() {
  const [md, setMd] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  useEffect(() => { api.get<{ md: string }>('/api/taste').then(r => setMd(r.md)); }, []);
  if (md === null) return <div className="h-full grid place-items-center"><Spinner className="text-gold" /></div>;
  const approved = (md.match(/^\|(?!\s*-)(?!\s*الموضوع)/gm) || []).length;
  const rejected = (md.split('## ❌')[1] || '').split('\n').filter(l => l.startsWith('- ')).length;
  return (
    <div className="max-w-[1080px] mx-auto px-6 lg:px-10 py-10">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-[28px] font-bold text-graphite flex items-center gap-2"><BookHeart className="text-gold-deep" /> سجل الذوق</h1>
          <p className="text-ink-soft mt-1 max-w-2xl leading-relaxed">ذاكرة المصمم: كل قرار معتمد ✅ أو مرفوض ❌. يُرسل مع كل طلب تصميم، ويكبر تلقائياً لما تعتمد أو ترفض نسخة وتكتب السبب.</p>
          <div className="flex gap-4 mt-3 text-[13px]"><span className="text-emerald-800">✅ {approved} معتمد</span><span className="text-red-800">❌ {rejected} مرفوض</span></div>
        </div>
        <button className="btn-primary" disabled={!dirty} onClick={async () => { await api.put('/api/taste', { md }); setDirty(false); toast('ok', 'انحفظ سجل الذوق'); }}><Save size={16} /> حفظ</button>
      </div>
      <textarea className="input font-mono text-[13px] leading-[1.9] h-[70vh]" value={md} onChange={e => { setMd(e.target.value); setDirty(true); }} spellCheck={false} />
    </div>
  );
}
