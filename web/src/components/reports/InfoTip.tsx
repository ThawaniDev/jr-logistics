"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import { useClampX } from "./useClamp";

/**
 * The "?" next to a number: shows its definition on hover, keyboard focus or tap (and closes on Escape / outside tap). `name` makes the button's accessible name
 * ("What does Delivery success rate mean?"); the text is also linked with `aria-describedby`.
 */
export function InfoTip({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const { ref, shift } = useClampX<HTMLSpanElement>(open);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span ref={wrap} className={cn("relative inline-flex", className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={t("rpf.what_is", { name })} aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
        className="jr-tap -m-1 flex size-6 items-center justify-center rounded-full p-1 text-muted hover:text-ink focus-visible:text-ink"><Info className="size-3.5" aria-hidden /></button>
      {open && (
        <span ref={ref} id={id} role="tooltip" style={{ transform: `translateX(${shift}px)` }} className="absolute start-0 top-full z-40 mt-1.5 block w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-bg2 p-3 text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-xl">{children}</span>
      )}
    </span>
  );
}
