// مزوّد الذكاء الاصطناعي — RadoxAI (واجهة متوافقة مع OpenAI: /v1/chat/completions) افتراضياً،
// أو Anthropic مباشرة (SDK الرسمي + كاش التعليمات). كل الاستدعاءات تمر من chat() بصيغة موحدة.
import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from '../settings.js';

export type Part = { type: 'text'; text: string } | { type: 'image'; data: string; media: string };
export interface Msg { role: 'user' | 'assistant'; content: string | Part[] }
export interface ChatReq {
  model: string; system: string[]; messages: Msg[]; maxTokens?: number; json?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; onDelta?: (chars: number) => void; signal?: AbortSignal;
}
export interface ChatRes { text: string; model: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number }; finish?: string }

export class AIError extends Error { constructor(msg: string, public status = 500, public retryable = false) { super(msg); } }

export function chat(req: ChatReq): Promise<ChatRes> {
  const s = getSettings();
  return s.provider === 'anthropic' ? anthropicChat(req) : radoxChat(req);
}

/* ── RadoxAI / أي واجهة OpenAI-compatible ── */
async function radoxChat(req: ChatReq): Promise<ChatRes> {
  const s = getSettings();
  if (!s.radoxKey) throw new AIError('مفتاح RadoxAI غير مضبوط — أضفه من الإعدادات أو RADOX_API_KEY بملف .env', 401);
  const messages = [
    { role: 'system', content: req.system.join('\n\n') },
    ...req.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: `data:${p.media};base64,${p.data}` } }),
    })),
  ];
  const body: any = { model: req.model, messages, max_tokens: req.maxTokens || 16000, stream: true };
  if (req.json) body.response_format = { type: 'json_object' };
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(s.radoxBaseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: req.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.radoxKey}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt * 2);
      if (attempt < 2) { await new Promise(r => setTimeout(r, wait * 1000)); continue; }
    }
    break;
  }
  if (!res!.ok) {
    let msg = `${res!.status}`;
    try { const j = await res!.json(); msg = j?.error?.message || j?.message || msg; } catch {}
    if (res!.status === 422 && /image/i.test(msg) && req.messages.some(m => typeof m.content !== 'string')) throw new AIError('الموديل ما يدعم الصور: ' + msg, 422);
    throw new AIError(`RadoxAI (${res!.status}): ${msg}`, res!.status, res!.status === 429 || res!.status >= 500);
  }
  // SSE: سطور data: {...} وتنتهي بـ data: [DONE] — الاستخدام بآخر قطعة
  const reader = res!.body!.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', usage: any = null, model = req.model, finish: string | undefined;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      let j: any; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new AIError('RadoxAI: ' + (j.error.message || 'خطأ أثناء البث'), Number(j.error.code) || 502, true);
      const d = j.choices?.[0]?.delta?.content; if (d) { text += d; req.onDelta?.(text.length); }
      if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
      if (j.usage) usage = j.usage; if (j.model) model = j.model;
    }
  }
  return { text, model: req.model, finish, usage: { input: usage?.prompt_tokens || 0, output: usage?.completion_tokens || 0,
    cacheRead: usage?.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0, reasoning: usage?.completion_tokens_details?.reasoning_tokens || 0 } };
}

/* ── Anthropic مباشرة: التعليمات الثابتة بكاش (أرخص بكثير بالتكرار) ── */
let client: Anthropic | null = null; let clientKey = '';
async function anthropicChat(req: ChatReq): Promise<ChatRes> {
  const s = getSettings();
  if (!s.anthropicKey) throw new AIError('مفتاح Anthropic غير مضبوط', 401);
  if (!client || clientKey !== s.anthropicKey) { client = new Anthropic({ apiKey: s.anthropicKey }); clientKey = s.anthropicKey; }
  // آخر كتلة تعليمات ثابتة تاخذ cache_control — الأجزاء المتغيرة تجي بالرسائل
  const system = req.system.map((t, i) => ({ type: 'text' as const, text: t, ...(i === req.system.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) }));
  const messages: Anthropic.MessageParam[] = req.messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text'
      ? { type: 'text' as const, text: p.text }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: p.media as 'image/jpeg' | 'image/png', data: p.data } }),
  }));
  try {
    const stream = client.messages.stream({
      model: req.model, max_tokens: req.maxTokens || 32000, system, messages,
      thinking: { type: 'adaptive' }, output_config: { effort: req.effort || 'high' },
    } as any, { signal: req.signal });
    let n = 0;
    stream.on('text', t => { n += t.length; req.onDelta?.(n); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AIError('الموديل رفض الطلب', 400);
    const text = msg.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
    const u: any = msg.usage;
    return { text, model: msg.model, finish: msg.stop_reason || undefined,
      usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 } };
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AIError('حد الاستخدام — حاول بعد قليل', 429, true);
    if (e instanceof Anthropic.APIError) throw new AIError(`Anthropic (${e.status}): ${e.message}`, e.status || 500, (e.status || 500) >= 500);
    throw e;
  }
}

/** يستخرج JSON من رد الموديل (حتى لو لفّه بـ ```json أو كتب قبله سطر) */
export function extractJSON(text: string): any {
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('الرد ما فيه JSON');
}
