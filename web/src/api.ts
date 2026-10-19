// عميل الـ API + أنواع البيانات
export interface Photo { id: string; name: string; file: string; w: number; h: number; aspect: number; alpha: boolean; bytes: number; note?: string; source?: 'upload' | 'gpt-image' | 'code-drawn'; prompt?: string;
  asset?: { kind: string; description?: string; rev: number; root?: string; parent?: string; slide?: number; field?: string; html?: string; history?: { at: string; instruction: string; prompt: string }[] } }
export interface QcSummary { score: number; errors: string[]; warnings: string[]; lint: string[] }
export interface Version {
  id: string; n: number; createdAt: string; source: 'ai' | 'manual' | 'draft' | 'variant'; label?: string; concept?: string;
  notes?: string[]; spec: any; qc?: QcSummary; feedback?: string; verdict?: 'approved' | 'rejected' | null; preview?: string;
}
export interface ChatMsg { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string }
export interface ExportInfo { id: string; version: string; at: string; files: string[]; score: number; dir: string }
export interface Post {
  id: string; n: number; title: string; ctype: string; platform: string; pillar: string; design: string; caption: string; notes: string;
  due: string; publish: string; status: string; link: string; service: string; theme: string; kind: 'single' | 'carousel' | 'story' | 'reel' | 'profile';
  photos: Photo[]; versions: Version[]; current?: string; exports: ExportInfo[]; state: 'new' | 'queued' | 'designing' | 'review' | 'approved'; chat: ChatMsg[]; updatedAt: string;
}
export interface Project { id: string; name: string; source?: string; createdAt: string; updatedAt: string; posts: Post[] }
export interface ProjectRow { id: string; name: string; createdAt: string; updatedAt: string; count: number; done: number; inReview: number }

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function req<T>(method: string, url: string, body?: any): Promise<T> {
  const isForm = body instanceof FormData;
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (r.status === 401 && !url.endsWith('/login')) window.dispatchEvent(new Event('ig:unauth'));
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError((data as any)?.error || `خطأ ${r.status}`, r.status);
  return data as T;
}

export const api = {
  get: <T>(u: string) => req<T>('GET', u),
  post: <T>(u: string, b?: any) => req<T>('POST', u, b ?? {}),
  put: <T>(u: string, b?: any) => req<T>('PUT', u, b),
  patch: <T>(u: string, b?: any) => req<T>('PATCH', u, b),
  del: <T>(u: string) => req<T>('DELETE', u),
};

export const postUrl = (pid: string, postId: string) => `/api/projects/${pid}/posts/${postId}`;

/** طلب يبث أحداث NDJSON (تقدم التصميم). body = null → GET (متابعة مهمة شغالة) */
export async function stream(url: string, body: any, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<any> {
  const r = await fetch(url, body === null
    ? { signal, credentials: 'same-origin' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal, credentials: 'same-origin' });
  if (!r.ok) { let m = `خطأ ${r.status}`; try { m = (await r.json()).error || m; } catch {} throw new ApiError(m, r.status); }
  const reader = r.body!.getReader(); const dec = new TextDecoder();
  let buf = '', result: any, error: string | undefined;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line); if (ev.type === 'ping') continue;
        onEvent(ev);
        if (ev.type === 'done') result = ev.result;
        if (ev.type === 'error') error = ev.message;
      } catch {}
    }
  }
  if (error) throw new ApiError(error, 500);
  return result;
}

export interface JobInfo { id: string; kind: string; label: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; error?: string; position?: number; startedAt?: string }

export const THEMES: { id: string; name: string; colors: string[]; group: 'svc' | 'brand' | 'other' }[] = [
  { id: 'svc_investor', name: 'خدمات المستثمرين', colors: ['#B3A47F', '#868789'], group: 'svc' },
  { id: 'svc_formation', name: 'تأسيس الشركات', colors: ['#E6E0D3', '#C7C8C9'], group: 'svc' },
  { id: 'svc_residency', name: 'الإقامة المميزة', colors: ['#868789', '#EEBF1C'], group: 'svc' },
  { id: 'svc_trademark', name: 'العلامة التجارية', colors: ['#C4B89B', '#9E9FA1'], group: 'svc' },
  { id: 'svc_accounting', name: 'المحاسبة والقوائم', colors: ['#F1C431', '#C7C8C9'], group: 'svc' },
  { id: 'graphite', name: 'العلامة الأم (فحمي)', colors: ['#26272A', '#A29265'], group: 'brand' },
  { id: 'olive', name: 'ذهبي الهوية', colors: ['#A29265', '#26272A'], group: 'brand' },
  { id: 'noir', name: 'نوار فخم', colors: ['#14110D', '#E2C38E'], group: 'other' },
  { id: 'ivory', name: 'عاجي رسمي', colors: ['#F4F1E9', '#A29265'], group: 'other' },
  { id: 'cream', name: 'كريمي تحريري', colors: ['#F3EAD8', '#8C734B'], group: 'other' },
  { id: 'gold', name: 'ذهبي دافئ', colors: ['#C9AE7C', '#3F372B'], group: 'other' },
  { id: 'sand', name: 'رملي', colors: ['#EBD3B4', '#443C2F'], group: 'other' },
  { id: 'espresso', name: 'إسبريسو', colors: ['#443C2F', '#CEB18F'], group: 'other' },
];
export const themeOf = (id: string) => THEMES.find(t => t.id === id) || { id, name: id, colors: ['#ccc', '#999'], group: 'other' as const };

export const KINDS: Record<string, string> = { single: 'منشور مفرد', carousel: 'كاروسيل', story: 'ستوري', reel: 'غلاف ريل', profile: 'صورة تعريفية' };
export const STATES: Record<Post['state'], { label: string; cls: string }> = {
  new: { label: 'جديد', cls: 'bg-ink/[.06] text-ink-soft' },
  queued: { label: 'بالطابور', cls: 'bg-sun/15 text-[#7a5d00]' },
  designing: { label: 'يُصمَّم الآن', cls: 'bg-sun/20 text-[#7a5d00]' },
  review: { label: 'بانتظار الاعتماد', cls: 'bg-gold/15 text-gold-deep' },
  approved: { label: 'معتمد', cls: 'bg-emerald-600/12 text-emerald-800' },
};
export const TIER_LABEL: Record<string, string> = { pro: 'القوي', balanced: 'المتوازن', fast: 'السريع', vision: 'البصري' };

export const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s); if (isNaN(+d)) return s;
  return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
};
export const money = (n?: number) => (n === undefined || n === null ? '—' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
