"use client";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";

export interface SignaturePadHandle {
  /** The signature as a PNG (black ink on white); null while the pad is empty. */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}
interface Pt { x: number; y: number } // 0..1 of the canvas, so a resize / rotation redraws the same signature
const MIN_INK_PX = 24; // a stray tap is not a signature

const lengthOf = (s: Pt[], w: number, h: number) => s.reduce((sum, p, i) => (i ? sum + Math.hypot((p.x - s[i - 1].x) * w, (p.y - s[i - 1].y) * h) : 0), 0);

/**
 * Touch / mouse / pen signature canvas. White background and dark ink so it is legible in sunlight and in the stored image.
 * `onChange(hasInk)` fires whenever the drawing becomes empty or non-empty; read the image through the ref (`toBlob`).
 */
export function SignaturePad({ ref, onChange, height = 200, className }: { ref?: Ref<SignaturePadHandle>; onChange?: (hasInk: boolean) => void; height?: number; className?: string }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);
  const cb = useRef(onChange);
  useEffect(() => { cb.current = onChange; });
  const [inkCount, setInkCount] = useState(0); // strokes, only for the buttons' disabled state

  const hasInk = () => { const c = canvasRef.current; if (!c) return false; const r = c.getBoundingClientRect(); return strokes.current.some((s) => lengthOf(s, r.width, r.height) >= MIN_INK_PX); };

  const paint = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const g = c.getContext("2d"); if (!g) return;
    const w = c.width; const h = c.height;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#0b132b"; g.fillStyle = "#0b132b"; g.lineWidth = Math.max(2, w / 220); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of strokes.current) {
      if (!s.length) continue;
      if (s.length === 1) { g.beginPath(); g.arc(s[0].x * w, s[0].y * h, g.lineWidth / 2, 0, Math.PI * 2); g.fill(); continue; }
      g.beginPath(); g.moveTo(s[0].x * w, s[0].y * h);
      for (let i = 1; i < s.length - 1; i++) { const mx = ((s[i].x + s[i + 1].x) / 2) * w; const my = ((s[i].y + s[i + 1].y) / 2) * h; g.quadraticCurveTo(s[i].x * w, s[i].y * h, mx, my); }
      const last = s[s.length - 1]; g.lineTo(last.x * w, last.y * h); g.stroke();
    }
  }, []);

  // Keep the bitmap crisp: internal size = CSS size × device pixel ratio, redrawn from the stored strokes whenever the box changes.
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const fit = () => { const r = c.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3); c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); paint(); };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [paint]);

  const notify = () => { setInkCount(strokes.current.length); cb.current?.(hasInk()); };
  const point = (e: React.PointerEvent<HTMLCanvasElement>): Pt => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); drawing.current = true; strokes.current.push([point(e)]); paint(); };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; e.preventDefault(); strokes.current[strokes.current.length - 1]?.push(point(e)); paint(); };
  const up = () => { if (!drawing.current) return; drawing.current = false; notify(); };
  const clear = () => { strokes.current = []; drawing.current = false; paint(); notify(); };
  const undo = () => { strokes.current.pop(); paint(); notify(); };

  useImperativeHandle(ref, () => ({
    clear,
    toBlob: () => new Promise<Blob | null>((resolve) => { const c = canvasRef.current; if (!c || !hasInk()) return resolve(null); c.toBlob((b) => resolve(b), "image/png"); }),
  }));

  return (
    <div className={cn("space-y-2", className)} data-testid="signature-pad">
      <div className="relative overflow-hidden rounded-2xl border-2 border-line bg-white">
        <canvas ref={canvasRef} data-testid="signature-canvas" role="img" aria-label={t("fod.sig_canvas")} style={{ height, touchAction: "none" }} className="block w-full cursor-crosshair"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        {inkCount === 0 && <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-400">{t("fod.sig_here")}</p>}
        <span aria-hidden className="pointer-events-none absolute inset-x-4 bottom-8 border-b border-dashed border-slate-300" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" data-testid="signature-undo" variant="secondary" size="lg" disabled={inkCount === 0} onClick={undo}><Undo2 className="size-4" aria-hidden />{t("fod.sig_undo")}</Button>
        <Button type="button" data-testid="signature-clear" variant="secondary" size="lg" disabled={inkCount === 0} onClick={clear}><Eraser className="size-4" aria-hidden />{t("fod.sig_clear")}</Button>
      </div>
    </div>
  );
}
