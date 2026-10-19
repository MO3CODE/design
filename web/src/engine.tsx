// المعاينة الحية: نفس محرك المهارة (engine/slide.html) داخل iframe — اللي تشوفه هو نفس اللي ينطبع 3×
import { useEffect, useRef, useState, memo } from 'react';
import { api } from './api';

export interface Boot { assets: any; fontCSS: string; brand: any; presets: { id: string; doc: string }[]; services: Record<string, string> }
let bootP: Promise<Boot> | null = null;
export const getBoot = () => (bootP ||= api.get<Boot>('/api/engine/boot').catch(e => { bootP = null; throw e; }));

export const SIZES: Record<string, [number, number]> = { post: [1080, 1350], story: [1080, 1920], tall: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
export const sizeOf = (spec: any) => SIZES[spec?.format || 'post'] || SIZES.post;

export interface SlideQC { errors: string[]; warnings: string[]; notes?: string[] }

/** شريحة وحدة مرسومة بالمحرك — تتصغّر لتناسب العرض المتاح */
export const SlideFrame = memo(function SlideFrame({ spec, index, width, onQC, className = '' }:
  { spec: any; index: number; width: number; onQC?: (qc: SlideQC) => void; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [W, H] = sizeOf(spec);
  const k = width / W;

  useEffect(() => {
    const f = ref.current; if (!f) return;
    const onLoad = async () => {
      const b = await getBoot();
      const doc = f.contentDocument!;
      doc.getElementById('fontcss')!.textContent = b.fontCSS;
      const fonts = (doc as any).fonts as FontFaceSet;
      try {
        await Promise.allSettled(['Expo', 'ThSans', 'ThSerif', 'Plex'].flatMap(ff => [400, 700].map(w => fonts.load(`${w} 40px ${ff}`))));
        await fonts.load('40px tabler').catch(() => {}); await fonts.ready;
      } catch {}
      setReady(true);
    };
    f.addEventListener('load', onLoad);
    return () => f.removeEventListener('load', onLoad);
  }, []);

  useEffect(() => {
    if (!ready || !spec) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      const b = await getBoot();
      const win = ref.current?.contentWindow as any; if (!win?.render) return;
      const slides = spec.slides || [spec];
      try {
        const qc = await win.render({ spec, slide: slides[index], i: index, n: slides.length, assets: b.assets, brand: b.brand });
        if (!cancelled) onQC?.(qc);
      } catch (e) { console.error(e); }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [ready, spec, index]);   // eslint-disable-line

  return (
    <div className={`relative overflow-hidden rounded-[10px] bg-graphite-2 ${className}`} style={{ width, height: H * k }}>
      <iframe ref={ref} src="/engine/slide.html" title={`slide-${index + 1}`} scrolling="no" tabIndex={-1}
        style={{ width: W, height: H, transform: `scale(${k})`, transformOrigin: 'top right', border: 0, position: 'absolute', top: 0, right: 0, pointerEvents: 'none' }} />
      {busy && <div className="absolute inset-0 shimmer" />}
    </div>
  );
});

/** يقيس عرض العنصر (للمعاينة المتجاوبة) */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
