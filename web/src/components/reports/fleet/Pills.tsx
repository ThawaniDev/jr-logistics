"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface Pill { key: string; label: string; testId?: string }

/**
 * The pill switch of the fleet centre: the same look and behaviour as `Segmented` (`components/ui`), with a `data-testid` on every pill so views and periods can be addressed
 * by tests (`fr-view-<name>`, `fr-period-<preset>`). On a phone a long row scrolls inside its own frame and keeps the selected pill in view.
 */
export function Pills({ options, value, onChange, label, testId }: { options: readonly Pill[]; value: string; onChange: (key: string) => void; label: string; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    el.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [value]);
  return (
    <div ref={box} role="group" aria-label={label} data-testid={testId} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-bg2 p-1">
      {options.map((o) => (
        <button key={o.key} type="button" data-testid={o.testId} aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition", value === o.key ? "bg-card font-semibold text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
