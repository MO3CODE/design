// حساب صرف التوكن بالكامل — كل استدعاء (نص أو صورة) ينسجّل بـ data/usage.jsonl ويُبث مباشرة لكل المتصفحات المفتوحة.
// التكلفة = أسعارك بالإعدادات (لكل مليون توكن) ← أسعار المنصة لو موجودة. الحسابات تُعاد عند تغيير الأسعار.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { DATA } from './config.js';
import { getSettings } from './settings.js';

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number; images?: number; imageIn?: number }
export interface UsageRow {
  at: string; kind: 'chat' | 'image'; task: string; tier: string; model: string;
  project?: string; post?: string; usage: Usage; ok: boolean; ms: number; cost?: number;
}

const LEDGER = path.join(DATA, 'usage.jsonl');
const bus = new EventEmitter(); bus.setMaxListeners(200);
let rows: UsageRow[] | null = null;

function load(): UsageRow[] {
  if (rows) return rows;
  rows = [];
  if (fs.existsSync(LEDGER)) for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); r.kind ||= r.tier === 'image' ? 'image' : 'chat'; rows.push(r); } catch {}
  }
  return rows;
}

/** سعر الموديل (لكل مليون توكن): الإعدادات أولاً ثم كتالوج المنصة (لكل 1000 × 1000) */
let catalogPrice: (model: string) => { in?: number; out?: number } | undefined = () => undefined;
export function setCatalogPricing(fn: typeof catalogPrice) { catalogPrice = fn; }
export function priceOf(model: string) {
  const s = getSettings().prices?.[model];
  if (s && (s.in || s.out)) return { in: s.in || 0, out: s.out || 0, cached: s.cached ?? (s.in || 0) * 0.1, source: 'settings' as const };
  const c = catalogPrice(model);
  if (c && (c.in || c.out)) return { in: c.in || 0, out: c.out || 0, cached: (c.in || 0) * 0.1, source: 'platform' as const };
  return null;
}
export function costOf(model: string, u: Usage): number | undefined {
  const p = priceOf(model); if (!p) return undefined;
  const fresh = Math.max(0, u.input - (u.cacheRead || 0));
  return (fresh * p.in + (u.cacheRead || 0) * p.cached + u.output * p.out) / 1e6;
}

export function record(e: Omit<UsageRow, 'at' | 'cost'>): number | undefined {
  const row: UsageRow = { at: new Date().toISOString(), ...e, cost: costOf(e.model, e.usage) };
  load().push(row);
  fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  bus.emit('row', row);
  return row.cost;
}

/** نعيد حساب التكلفة من الأسعار الحالية (لو عدّلتها بعدين تتحدث كل الأرقام) */
const cost = (r: UsageRow) => costOf(r.model, r.usage) ?? r.cost ?? 0;
const tok = (r: UsageRow) => (r.usage.input || 0) + (r.usage.output || 0);

type Agg = { calls: number; input: number; output: number; reasoning: number; cached: number; images: number; tokens: number; cost: number; priced: boolean };
const empty = (): Agg => ({ calls: 0, input: 0, output: 0, reasoning: 0, cached: 0, images: 0, tokens: 0, cost: 0, priced: true });
function add(a: Agg, r: UsageRow) {
  a.calls++; a.input += r.usage.input || 0; a.output += r.usage.output || 0; a.reasoning += r.usage.reasoning || 0;
  a.cached += r.usage.cacheRead || 0; a.images += r.usage.images || 0; a.tokens += tok(r);
  const c = costOf(r.model, r.usage); if (c === undefined) a.priced = false; a.cost += c ?? 0;
  return a;
}
const group = (list: UsageRow[], key: (r: UsageRow) => string | undefined) => {
  const out: Record<string, Agg> = {};
  for (const r of list) { const k = key(r); if (!k) continue; add(out[k] ||= empty(), r); }
  return out;
};

export function summary(filter: { project?: string; post?: string } = {}) {
  let list = load();
  if (filter.project) list = list.filter(r => r.project === filter.project);
  if (filter.post) list = list.filter(r => r.post === filter.post);
  const day = new Date().toISOString().slice(0, 10), mo = day.slice(0, 7);
  const all = list.reduce(add, empty());
  const today = list.filter(r => r.at.startsWith(day)).reduce(add, empty());
  const month = list.filter(r => r.at.startsWith(mo)).reduce(add, empty());
  const last30 = Date.now() - 30 * 864e5;
  const days = group(list.filter(r => +new Date(r.at) >= last30), r => r.at.slice(0, 10));
  const models = [...new Set(list.map(r => r.model))];
  return {
    all, today, month, budget: getSettings().monthlyBudget,
    byTier: group(list, r => r.tier), byTask: group(list, r => r.task), byModel: group(list, r => r.model),
    byPost: group(list, r => r.post), byProject: group(list, r => r.project), byDay: days,
    unpriced: models.filter(m => !priceOf(m)),
    recent: list.slice(-40).reverse().map(r => ({ ...r, cost: costOf(r.model, r.usage) ?? r.cost })),
  };
}

/** بث مباشر (SSE): كل سطر جديد + الإجماليات المحدّثة */
export function live(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const totals = () => { const s = summary(); return { today: s.today, month: s.month, all: s.all, budget: s.budget }; };
  const send = (ev: string, data: any) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  send('totals', totals());
  const on = (row: UsageRow) => { send('row', { ...row, cost: cost(row) }); send('totals', totals()); };
  bus.on('row', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => { clearInterval(ping); bus.off('row', on); });
}

/** لما تتغير الأسعار نبلّغ المتصفحات تعيد الحساب */
export function pricesChanged() { bus.emit('row', { at: new Date().toISOString(), kind: 'chat', task: '__prices', tier: '', model: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ok: true, ms: 0 }); }
