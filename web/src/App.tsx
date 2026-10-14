import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, Settings as Cog, Wallet, BookHeart, LogOut, Lock, AlertTriangle } from 'lucide-react';
import { api } from './api';
import { Spinner } from './ui';
import { UsageMeter } from './usage';
import Projects from './pages/Projects';
import ProjectPage from './pages/Project';
import PostPage from './pages/Post';
import SettingsPage from './pages/Settings';
import UsagePage from './pages/Usage';
import TastePage from './pages/Taste';

/* ── موجّه بسيط بالـ hash ── */
export function useRoute() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => setH(location.hash.slice(1) || '/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (p: string) => { location.hash = p; };

interface Health { provider: string; aiReady: boolean; cutout: boolean; fonts: Record<string, boolean>; exportScale: number }

export default function App() {
  const [auth, setAuth] = useState<{ authed: boolean; auth: boolean } | null>(null);
  useEffect(() => {
    api.get<{ authed: boolean; auth: boolean }>('/api/me').then(setAuth).catch(() => setAuth({ authed: false, auth: true }));
    const f = () => setAuth(a => (a ? { ...a, authed: false } : a));
    window.addEventListener('ig:unauth', f); return () => window.removeEventListener('ig:unauth', f);
  }, []);
  if (!auth) return <div className="h-full grid place-items-center paper"><Spinner size={22} className="text-gold" /></div>;
  if (!auth.authed) return <Login onOk={() => setAuth({ ...auth, authed: true })} />;
  return <Shell canLogout={auth.auth} />;
}

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="h-full grid place-items-center bg-graphite relative overflow-hidden">
      <div className="absolute -left-40 -bottom-40 w-[700px] opacity-[.07]"><img src="/symbol-gold.svg" alt="" /></div>
      <form className="relative w-[min(400px,92vw)] text-center" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setErr('');
        try { await api.post('/api/login', { password: pw }); onOk(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
      }}>
        <img src="/logo-white.svg" alt="بوابة المستثمر" className="h-24 mx-auto mb-8" />
        <div className="text-ivory/60 text-sm mb-6">استوديو التصاميم</div>
        <div className="relative">
          <Lock size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ivory/40" />
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="كلمة المرور"
            className="w-full h-12 rounded-xl bg-white/[.06] border border-white/10 text-ivory pr-10 pl-4 outline-none focus:border-gold-light/60" />
        </div>
        {err && <div className="text-red-300 text-sm mt-3">{err}</div>}
        <button className="btn-gold w-full h-12 mt-4 text-[15px]" disabled={busy || !pw}>{busy ? <Spinner /> : 'دخول'}</button>
      </form>
    </div>
  );
}

function NavItem({ href, icon, label, active, compact }: { href: string; icon: ReactNode; label: string; active: boolean; compact?: boolean }) {
  const lg = compact ? 'hidden' : 'hidden lg:inline';
  return (
    <a href={'#' + href} title={label} className={`group flex items-center gap-3 rounded-xl px-3 h-11 text-[14px] font-semibold transition ${
      active ? 'bg-white/[.08] text-ivory' : 'text-ivory/55 hover:text-ivory hover:bg-white/[.04]'}`}>
      <span className={active ? 'text-gold-light' : 'text-ivory/45 group-hover:text-ivory/80'}>{icon}</span>
      <span className={lg}>{label}</span>
      {active && !compact && <span className="mr-auto hidden lg:block h-1.5 w-1.5 rounded-full bg-gold-light" />}
    </a>
  );
}

function Shell({ canLogout }: { canLogout: boolean }) {
  const route = useRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => { api.get<Health>('/api/health').then(setHealth).catch(() => {}); }, [route.startsWith('/settings')]);
  const parts = route.split('/').filter(Boolean);
  const inPost = parts[0] === 'p' && !!parts[2];
  let page: ReactNode;
  if (parts[0] === 'p' && parts[1] && parts[2]) page = <PostPage key={parts[2]} pid={parts[1]} postId={parts[2]} health={health} />;
  else if (parts[0] === 'p' && parts[1]) page = <ProjectPage key={parts[1]} pid={parts[1]} />;
  else if (parts[0] === 'settings') page = <SettingsPage health={health} />;
  else if (parts[0] === 'usage') page = <UsagePage />;
  else if (parts[0] === 'taste') page = <TastePage />;
  else page = <Projects health={health} />;
  return (
    <div className="h-full flex">
      <aside className={`shrink-0 ${inPost ? 'w-[68px]' : 'w-[68px] lg:w-[232px]'} bg-graphite text-ivory flex flex-col relative overflow-hidden`}>
        <div className="absolute -bottom-24 -left-28 w-[340px] opacity-[.05] pointer-events-none"><img src="/symbol-gold.svg" alt="" /></div>
        <a href="#/" className="flex items-center justify-center lg:justify-start gap-3 h-[76px] px-4 border-b border-white/[.06]">
          <img src="/symbol-gold.svg" className={`h-9 ${inPost ? '' : 'lg:hidden'}`} alt="" />
          {!inPost && <img src="/logo-white.svg" className="h-12 hidden lg:block" alt="بوابة المستثمر" />}
        </a>
        {!inPost && <div className="hidden lg:block px-5 pt-5 pb-2 text-[11px] tracking-wide text-ivory/35 font-semibold">استوديو التصاميم</div>}
        <nav className="flex flex-col gap-1 p-3 lg:pt-1">
          <NavItem href="/" icon={<LayoutGrid size={19} />} label="الخطط والمنشورات" compact={inPost} active={!parts[0] || parts[0] === 'p'} />
          <NavItem href="/taste" icon={<BookHeart size={19} />} label="سجل الذوق" compact={inPost} active={parts[0] === 'taste'} />
          <NavItem href="/usage" icon={<Wallet size={19} />} label="الاستهلاك والتكلفة" compact={inPost} active={parts[0] === 'usage'} />
          <NavItem href="/settings" icon={<Cog size={19} />} label="الإعدادات والموديلات" compact={inPost} active={parts[0] === 'settings'} />
        </nav>
        <div className="mt-auto p-3 space-y-2 relative">
          <UsageMeter compact={inPost} />
          {health && !health.aiReady && (
            <a href="#/settings" className="flex items-start gap-2 rounded-xl bg-sun/10 border border-sun/25 p-3 text-[12px] text-sun/90 leading-relaxed">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span className={inPost ? 'hidden' : 'hidden lg:inline'}>أضف مفتاح الـ API لتفعيل التصميم الذكي</span>
            </a>
          )}
          {canLogout && (
            <button onClick={async () => { await api.post('/api/logout'); location.reload(); }} className="w-full flex items-center justify-center lg:justify-start gap-3 rounded-xl px-3 h-10 text-[13px] text-ivory/45 hover:text-ivory hover:bg-white/[.04]">
              <LogOut size={17} /><span className="hidden lg:inline">خروج</span>
            </button>
          )}
        </div>
      </aside>
      <main className={`flex-1 min-w-0 paper ${inPost ? 'overflow-hidden' : 'overflow-auto'}`}>{page}</main>
    </div>
  );
}
