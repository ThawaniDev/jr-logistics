"use client";
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import { THEME_MODES, type ThemeMode } from "@/lib/theme";
import { useTheme } from "./theme-provider";

const ICON: Record<ThemeMode, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { system: Monitor, light: Sun, dark: Moon };

/** Top-bar / header control: one icon button that opens a three-item menu (System · Light · Dark). */
export function ThemeMenu({ className }: { className?: string }) {
  const t = useT(); const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const Icon = ICON[mode];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={box} className={cn("relative", className)} onKeyDown={onKey}>
      <button ref={btn} type="button" data-testid="theme-menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={t("theme.aria", { mode: t(`theme.${mode}`) })} title={t("theme.label")} onClick={() => setOpen((v) => !v)}
        className="jr-tap flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-line/80 light:border-line-strong bg-card/70 text-ink backdrop-blur-sm transition hover:border-accent/60 focus-visible:border-accent">
        <Icon className="size-4" aria-hidden />
      </button>
      {open && (
        <div id={id} role="menu" aria-label={t("theme.label")} className="absolute end-0 top-full z-50 mt-2 w-44 rounded-xl border border-line bg-card p-1 shadow-xl">
          {THEME_MODES.map((m) => {
            const I = ICON[m]; const on = m === mode;
            return (
              <button key={m} type="button" role="menuitemradio" aria-checked={on} tabIndex={on ? 0 : -1} data-testid={`theme-${m}`} onClick={() => { setMode(m); setOpen(false); btn.current?.focus(); }}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition hover:bg-bg2", on ? "font-semibold text-accent" : "text-ink")}>
                <I className="size-4 shrink-0" aria-hidden /><span className="flex-1">{t(`theme.${m}`)}</span>{on && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The three modes as a radio-style switch (icon + label). `labelledBy` names the group; `testIdPrefix` keeps ids unique when it appears twice on a page. */
export function ThemeSegmented({ labelledBy, testIdPrefix = "theme-choice", className }: { labelledBy: string; testIdPrefix?: string; className?: string }) {
  const t = useT(); const { mode, setMode } = useTheme();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={cn("inline-flex max-w-full gap-1 rounded-xl border border-line bg-bg2 p-1", className)}>
      {THEME_MODES.map((m) => {
        const I = ICON[m]; const on = m === mode;
        return (
          <button key={m} type="button" role="radio" aria-checked={on} data-testid={`${testIdPrefix}-${m}`} onClick={() => setMode(m)}
            className={cn("flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm transition", on ? "bg-accent font-semibold text-accent-ink" : "text-muted hover:text-ink")}>
            <I className="size-4 shrink-0" aria-hidden />{t(`theme.${m}`)}
          </button>
        );
      })}
    </div>
  );
}

/** Profile pages: the same choice as a labelled three-way switch with a short explanation. */
export function ThemeChoice({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={className} data-testid="theme-choice">
      <p id="theme-choice-label" className="text-sm font-semibold">{t("theme.profile_title")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("theme.profile_hint")}</p>
      <ThemeSegmented labelledBy="theme-choice-label" className="mt-3" />
    </div>
  );
}
