"use client";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, X, Inbox, AlertTriangle, ChevronRight, ChevronLeft, Search, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api";

// ───────── Button ─────────
const VARIANT = {
  primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold",
  secondary: "border border-line bg-bg2 text-ink hover:border-accent/60 hover:bg-card",
  ghost: "text-muted hover:text-ink hover:bg-card",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
  gold: "border border-gold/50 text-gold hover:bg-gold/10",
} as const;
const SIZE = { sm: "h-8 px-3 text-xs pointer-coarse:h-10", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" } as const;
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE; loading?: boolean; full?: boolean }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "primary", size = "md", loading, full, className, children, disabled, ...p }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} className={cn("inline-flex items-center justify-center gap-2 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed select-none", VARIANT[variant], SIZE[size], full && "w-full", className)} {...p}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
});

// ───────── Fields ─────────
const inputCls = "w-full rounded-xl border border-line bg-bg2 px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 aria-[invalid=true]:border-danger";
export function Field({ label, error, hint, children, required }: { label?: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; required?: boolean }) {
  const id = useId();
  const dId = error || hint ? `${id}-d` : undefined;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="block text-xs font-medium text-muted">{label}{required && <span className="text-accent" aria-hidden> *</span>}</label>}
      {children(id, dId)}
      {error ? <p id={dId} role="alert" className="text-xs text-danger">{error}</p> : hint ? <p id={dId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
interface InProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; hint?: string; ltr?: boolean }
export const Input = forwardRef<HTMLInputElement, InProps>(function Input({ label, error, hint, ltr, className, required, ...p }, ref) {
  return <Field label={label} error={error} hint={hint} required={required}>{(id, d) => <input ref={ref} id={id} aria-invalid={!!error} aria-describedby={d} required={required} aria-required={required || undefined} dir={ltr ? "ltr" : undefined} className={cn(inputCls, "h-10", ltr && "text-start", className)} {...p} />}</Field>;
});
interface TaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; error?: string; hint?: string }
export const Textarea = forwardRef<HTMLTextAreaElement, TaProps>(function Textarea({ label, error, hint, className, required, ...p }, ref) {
  return <Field label={label} error={error} hint={hint} required={required}>{(id, d) => <textarea ref={ref} id={id} aria-invalid={!!error} aria-describedby={d} className={cn(inputCls, "min-h-24 py-2", className)} {...p} />}</Field>;
});
interface SelProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: string; error?: string; hint?: string; options: Array<{ value: string; label: string }>; placeholder?: string }
export const Select = forwardRef<HTMLSelectElement, SelProps>(function Select({ label, error, hint, options, placeholder, className, required, ...p }, ref) {
  return <Field label={label} error={error} hint={hint} required={required}>{(id, d) => (
    <select ref={ref} id={id} aria-invalid={!!error} aria-describedby={d} className={cn(inputCls, "h-10 appearance-none bg-no-repeat pe-8", className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>)}</Field>;
});
export function Checkbox({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--jr-accent)]" {...p} /><span>{label}</span></label>;
}

// ───────── Surfaces ─────────
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-card p-5", className)} {...p}>{children}</div>;
}
export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  const t = useT();
  return (
    <nav aria-label={t("a11y.breadcrumb")} className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 opacity-60 rtl:rotate-180" aria-hidden />}
              {it.href && !last ? <Link href={it.href} className="rounded hover:text-ink hover:underline">{it.label}</Link> : <span aria-current={last ? "page" : undefined} className={last ? "text-ink/80" : undefined}>{it.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
/** Page title row. `breadcrumbs` sit above the title (use them on every detail page), `badges` right after it, `icon` is a tinted chip before it. */
export function PageHeader({ title, subtitle, actions, breadcrumbs, badges, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: Array<{ label: string; href?: string }>; badges?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden>{icon}</span>}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{badges}</div>
            {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// ───────── KPI cards ─────────
const STAT_TONE = {
  accent: { text: "text-accent", chip: "bg-accent/10 text-accent" },
  cyan: { text: "text-cyan", chip: "bg-cyan/10 text-cyan" },
  gold: { text: "text-gold", chip: "bg-gold/10 text-gold" },
  muted: { text: "text-ink", chip: "bg-line/50 text-muted" },
  danger: { text: "text-danger", chip: "bg-danger/10 text-danger" },
} as const;
export type StatTone = keyof typeof STAT_TONE;
/**
 * KPI card: label, big value, optional icon chip, hint and trend. With `href` the whole card is a link (hover lift + focus ring).
 * `delta` shows a trend pill ("+12%"); `dir` picks the arrow, `good` colours it (a falling cancellation rate is good, so the two are separate).
 */
export function Stat({ label, value, hint, tone = "accent", icon, href, delta, loading, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: StatTone; icon?: ReactNode; href?: string; delta?: { label: string; dir?: "up" | "down" | "flat"; good?: boolean }; loading?: boolean; className?: string }) {
  const c = STAT_TONE[tone];
  const DeltaIcon = delta?.dir === "up" ? ArrowUpRight : delta?.dir === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted sm:text-[13px]">{label}</p>
          <div className={cn("mt-1 text-xl font-bold leading-tight tabular-nums sm:mt-1.5 @[13rem]:text-2xl", c.text)}>{loading ? <Skeleton className="h-7 w-24" /> : value}</div>
        </div>
        {icon && <span className={cn("hidden size-9 shrink-0 items-center justify-center rounded-xl @[11.5rem]:flex sm:size-10", c.chip)} aria-hidden>{icon}</span>}
      </div>
      {(hint || delta) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {delta && <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", delta.good === false ? "bg-danger/10 text-danger" : delta.good ? "bg-accent/10 text-accent" : "bg-line/50 text-muted")}><DeltaIcon className="size-3" aria-hidden />{delta.label}</span>}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </>
  );
  const cls = cn("@container block min-w-0 rounded-card border border-line bg-card p-3 sm:p-4", href && "transition hover:-translate-y-0.5 hover:border-accent/40", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
/** The grid every KPI row uses: 2 columns on phones, `cols` from the large breakpoint up. */
export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  const c = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-3 xl:grid-cols-5", 6: "lg:grid-cols-3 2xl:grid-cols-6" }[cols];
  return <div className={cn("grid grid-cols-2 gap-2.5 sm:gap-3", c, className)}>{children}</div>;
}
export function ProgressBar({ value, max = 100, tone = "accent", label }: { value: number; max?: number; tone?: "accent" | "gold" | "danger" | "cyan"; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bar = { accent: "bg-accent", gold: "bg-gold", danger: "bg-danger", cyan: "bg-cyan" }[tone];
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-1.5 w-full overflow-hidden rounded-full bg-line/60"><div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} /></div>;
}

// ───────── Sections & detail views ─────────
/** A titled card. `flush` removes the padding so a <Table bare> can sit edge to edge inside it. */
export function Section({ title, description, actions, children, flush, className, id }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-card border border-line bg-card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted">{description}</p>}</div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  );
}
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join("").toUpperCase() || "?";
  return <span aria-hidden style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient font-bold text-accent-ink", className)}>{initials}</span>;
}
/** Label / value pairs in a responsive grid (read-only facts about an entity). */
export function InfoGrid({ items, cols = 2 }: { items: Array<{ label: string; value: ReactNode }>; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <dl className={cn("grid gap-x-8 gap-y-4", c)}>{items.map((it, i) => <div key={i} className="min-w-0"><dt className="text-xs text-muted">{it.label}</dt><dd className="mt-0.5 break-words text-sm font-medium">{it.value ?? "—"}</dd></div>)}</dl>;
}
/** The top of an entity view (company, office, driver, request …): avatar, name, status badges, key facts and the primary actions. */
export function DetailHeader({ name, subtitle, badges, avatar, facts, actions }: { name: string; subtitle?: ReactNode; badges?: ReactNode; avatar?: ReactNode; facts?: Array<{ label: string; value: ReactNode }>; actions?: ReactNode }) {
  return (
    <div className="mb-5 rounded-card border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {avatar ?? <Avatar name={name} size={56} />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{name}</h1>{badges}</div>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {facts && facts.length > 0 && <div className="mt-5 border-t border-line pt-4"><InfoGrid cols={4} items={facts} /></div>}
    </div>
  );
}

const TONE = {
  success: "border-accent/40 bg-accent/10 text-accent", info: "border-cyan/40 bg-cyan/10 text-cyan", warn: "border-gold/40 bg-gold/10 text-gold",
  danger: "border-danger/40 bg-danger/10 text-danger", neutral: "border-line bg-bg2 text-muted",
} as const;
export type Tone = keyof typeof TONE;
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{children}</span>;
}
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral", published: "info", filling: "info", assigned: "info", confirmed: "info", in_progress: "warn", completed: "success", cancelled: "danger", expired: "neutral",
  offered: "info", accepted: "info", arrived: "info", attendance_confirmed: "warn", delivered_reported: "warn", qty_disputed: "danger", pending_settlement: "warn", rejected: "danger", no_show: "danger", replaced: "neutral",
  pending: "warn", verified: "success", approved: "success", info_requested: "warn", suspended: "danger", active: "success", submitted: "warn", under_review: "warn",
  pending_review: "warn", reviewed: "info", paid: "success", failed: "danger", open: "warn", in_review: "info", resolved: "success", closed: "neutral", in_progress_c: "info",
  handed_over: "info", acknowledged: "info", returned: "success", not_returned: "danger", damaged: "danger", delivered: "success", retry_wait: "warn", dead_letter: "danger", queued: "neutral",
};
export function StatusBadge({ status, ns = "status" }: { status: string; ns?: string }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`${ns}.${status}`)}</Badge>;
}

// ───────── States ─────────
export function Spinner({ className }: { className?: string }) { const t = useT(); return <Loader2 className={cn("size-5 animate-spin text-accent", className)} role="img" aria-label={t("a11y.loading")} />; }
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-xl bg-line/50", className)} />;
export function PageLoading() {
  return <div className="space-y-4" aria-busy="true" role="status"><Skeleton className="h-8 w-56" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-64" /></div>;
}
export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line px-6 py-12 text-center">
      <div className="text-muted">{icon ?? <Inbox className="size-9" aria-hidden />}</div>
      <p className="font-semibold">{title}</p>{hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}{action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-card border border-danger/40 bg-danger/5 px-6 py-10 text-center">
      <AlertTriangle className="size-8 text-danger" aria-hidden />
      <p className="font-semibold">{t("common.error_title")}</p><p className="text-sm text-muted">{errText(error, t)}</p>
      {retry && <Button variant="secondary" size="sm" onClick={retry}>{t("common.retry")}</Button>}
    </div>
  );
}
export function Notice({ tone = "info", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", TONE[tone])}>{title && <p className="mb-0.5 font-semibold">{title}</p>}<div className="text-ink/90">{children}</div></div>;
}

// ───────── Modal (native <dialog>: focus trap, ESC, inert background) ─────────
/** `busy` (an action is running) and `persistent` (the content must not be lost by accident, e.g. a secret shown once) block Esc / backdrop dismissal; the explicit buttons still work. */
export function Modal({ open, onClose, title, children, footer, busy, persistent }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; busy?: boolean; persistent?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const locked = !!(busy || persistent);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="jr-modal" onClose={onClose} onCancel={(e) => { if (busy || persistent) e.preventDefault(); }} onClick={(e) => { if (e.target === ref.current && !locked) onClose(); }} aria-label={title}>
      {open && (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4"><h2 className="font-semibold">{title}</h2><button type="button" onClick={onClose} disabled={!!busy} className="jr-tap -me-1 flex items-center justify-center rounded-lg p-1 text-muted hover:text-ink disabled:opacity-40" aria-label={t("common.close")}><X className="size-5" /></button></div>
          <div className="space-y-4 px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ───────── Table ─────────
type Col = string | { label: string; align?: "start" | "center" | "end"; className?: string; srOnly?: boolean };
const ALIGN = { start: "text-start", center: "text-center", end: "text-end" } as const;
/**
 * `head` entries are strings or `{ label, align: "end" }` (numbers/amounts right-aligned, set the same `align` on the <Td>). `label` names the scroll region for screen readers.
 * `stack` turns each row into a card on phones (give every <Td> a `label`). `toolbar` renders a filter row inside the card, `footer` the pagination row.
 * `bare` drops the outer border so the table can sit flush inside a <Section flush>. `dense` tightens the rows.
 * Wide tables scroll sideways; a fade on the trailing edge shows there is more, and the region is keyboard-focusable while it scrolls.
 */
export function Table({ head, children, empty, label, stack, bare, dense, toolbar, footer }: { head: Col[]; children: ReactNode; empty?: ReactNode; label?: string; stack?: boolean; bare?: boolean; dense?: boolean; toolbar?: ReactNode; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = box.current; if (!el) return;
    setMore(el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 6);
  }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el); if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => ro?.disconnect();
  }, [measure]);
  const cols = head.map((h) => (typeof h === "string" ? { label: h } : h));
  return (
    <div className={cn("overflow-hidden", !bare && "rounded-card border border-line bg-card", stack && "jr-stack", dense && "jr-dense")}>
      {toolbar && <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">{toolbar}</div>}
      <div ref={box} onScroll={measure} tabIndex={more ? 0 : undefined} role={more ? "region" : undefined} aria-label={more ? (label ?? cols.map((c) => c.label).filter(Boolean).join(" · ")) : undefined} className={cn("overflow-x-auto", more && "jr-fade-end")}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-bg2/70 text-[11px] font-semibold uppercase tracking-wider text-muted"><tr>{cols.map((c, i) => <th key={i} scope="col" className={cn("px-4 py-2.5", ALIGN[c.align ?? "start"], c.className)}>{c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line/70 [&>tr]:transition-colors [&>tr:hover]:bg-bg2/50">{children}</tbody>
        </table>
      </div>
      {empty}
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </div>
  );
}
export const Td = ({ children, className, label, align, num }: { children?: ReactNode; className?: string; label?: string; align?: "start" | "center" | "end"; num?: boolean }) => <td data-label={label} className={cn("px-4 py-3 align-middle", (align || num) && ALIGN[align ?? "end"], num && "ltr-num tabular-nums", className)}>{children}</td>;
/** A table cell with a name and a muted second line (phone, ref, city …). */
export function CellPair({ title, sub, href, className }: { title: ReactNode; sub?: ReactNode; href?: string; className?: string }) {
  return <div className={cn("min-w-0", className)}><div className="truncate font-medium">{href ? <Link href={href} className="text-accent hover:underline">{title}</Link> : title}</div>{sub && <div className="truncate text-xs text-muted">{sub}</div>}</div>;
}
export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label={t("common.page_of", { page, pages })}>
      <span aria-live="polite"><span className="ltr-num tabular-nums">{t("common.range_of", { from, to, total })}</span><span className="mx-2 opacity-40" aria-hidden>·</span>{t("common.page_of", { page, pages })}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />{t("common.prev")}</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("common.next")}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Button>
      </div>
    </nav>
  );
}

// ───────── Filters ─────────
/** The row above a list: search, filters, then (via `end`) counts and actions. */
export function Toolbar({ children, end, className }: { children?: ReactNode; end?: ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-2.5", className)}>{children}{end && <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div>}</div>;
}
export function SearchBox({ value, onChange, placeholder, label, className, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string; testId?: string }) {
  const t = useT();
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input type="text" inputMode="search" enterKeyHint="search" autoComplete="off" data-testid={testId} aria-label={label ?? placeholder ?? t("common.search")} placeholder={placeholder ?? t("common.search")} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "h-10 ps-9", value && "pe-9")} />
      {value && <button type="button" onClick={() => onChange("")} aria-label={t("common.clear")} className="jr-tap absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink"><X className="size-4" aria-hidden /></button>}
    </div>
  );
}
/** Pill filter for a *state of the same list* (status, role, period). Use <Tabs>/<LinkTabs> only for different content, and a sidebar page for a different function. */
export function Segmented({ options, value, onChange, label }: { options: Array<{ key: string; label: string; count?: number; icon?: ReactNode }>; value: string; onChange: (k: string) => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // On phones a long pill row scrolls sideways: keep the selected pill visible (only when the row really overflows, and never moving the page vertically).
  useEffect(() => {
    const el = box.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    el.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [value]);
  return (
    <div ref={box} role="group" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-bg2 p-1">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition", value === o.key ? "bg-card font-semibold text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}>
          {o.icon}{o.label}{o.count != null && <span className="rounded-full bg-bg px-1.5 text-xs tabular-nums text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────── Tab bars ─────────
const tabCls = (on: boolean) => cn("inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition -mb-px", on ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:border-line hover:text-ink");
const countCls = (on: boolean) => cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-accent/15 text-accent" : "bg-bg2 text-muted");
/** In-page tabs for different *content of one record* (e.g. the sections of a form). Different functions are separate pages: use the sidebar or <LinkTabs>. */
export function Tabs({ tabs, value, onChange, label }: { tabs: Array<{ key: string; label: string; count?: number; icon?: ReactNode }>; value: string; onChange: (k: string) => void; label?: string }) {
  const list = useRef<HTMLDivElement>(null);
  // Arrow keys move between tabs (the visual order flips in RTL), Home/End jump to the ends.
  function onKey(e: React.KeyboardEvent) {
    const i = tabs.findIndex((x) => x.key === value); if (i < 0) return;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = e.key === "ArrowRight" ? (rtl ? i - 1 : i + 1) : e.key === "ArrowLeft" ? (rtl ? i + 1 : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const k = tabs[(next + tabs.length) % tabs.length].key;
    onChange(k);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(k)}"]`)?.focus());
  }
  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((x) => (
        <button key={x.key} type="button" role="tab" data-tab={x.key} aria-selected={value === x.key} tabIndex={value === x.key ? 0 : -1} onClick={() => onChange(x.key)} className={tabCls(value === x.key)}>
          {x.icon}{x.label}{x.count != null && <span className={countCls(value === x.key)}>{x.count}</span>}
        </button>
      ))}
    </div>
  );
}
/**
 * Route-based tab bar: every tab is its own URL (deep-linkable, back button works). Use it under an entity header (`/admin/companies/:id/orders`)
 * and for the sub-pages of one function. The longest matching href wins, so the first tab can be the entity's base path.
 */
export function LinkTabs({ tabs, label }: { tabs: Array<{ href: string; label: string; count?: number; icon?: ReactNode }>; label?: string }) {
  const path = usePathname();
  const hit = (h: string) => path === h || path.startsWith(h + "/");
  const active = (x: { href: string }) => hit(x.href) && !tabs.some((o) => o.href.length > x.href.length && hit(o.href));
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((x) => { const on = active(x); return (
        <Link key={x.href} href={x.href} aria-current={on ? "page" : undefined} className={tabCls(on)}>{x.icon}{x.label}{x.count != null && <span className={countCls(on)}>{x.count}</span>}</Link>
      ); })}
    </nav>
  );
}
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const t = useT();
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label={t("a11y.steps")}>
      {steps.map((s, i) => (
        <li key={i} className="flex flex-1 items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold", i < current ? "border-accent bg-accent text-accent-ink" : i === current ? "border-accent text-accent" : "border-line text-muted")}>{i + 1}</span>
          <span className={cn("hidden text-xs sm:block", i === current ? "text-ink" : "text-muted")}>{s}</span>
          {i < steps.length - 1 && <span className={cn("h-px flex-1", i < current ? "bg-accent" : "bg-line")} />}
        </li>
      ))}
    </ol>
  );
}
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line/50 py-2.5 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="text-end font-medium">{children}</dd></div>;
}

// ───────── Errors & actions ─────────
export function errText(e: unknown, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (e instanceof ApiError) {
    const m = t(`err.${e.code}`);
    const base = m.startsWith("err.") ? e.message : m;
    // Eligibility failures list WHY in the user's language; other business-rule errors keep the server's specific sentence
    // (English-only today) after the localized headline so the user is never left with a bare "not allowed".
    const reasons = Array.isArray((e.details as { reasons?: unknown }).reasons) ? ((e.details as { reasons: string[] }).reasons) : [];
    if (reasons.length) return `${base}: ${reasons.map((r) => { const k = t(`reason.${r}`); return k.startsWith("reason.") ? r : k; }).join(", ")}`;
    if (["CONFLICT", "FORBIDDEN", "INVALID_TRANSITION"].includes(e.code) && e.message && e.message !== e.code && e.message !== base) return `${base} — ${e.message}`;
    return base;
  }
  return t("err.INTERNAL");
}
export function fieldErrors(e: unknown): Record<string, string> {
  if (e instanceof ApiError && e.code === "VALIDATION") {
    const d = e.details as Record<string, unknown>;
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k.replace(/^_$/, "form"), String(v)]));
  }
  return {};
}
/**
 * Runs an async action with loading state; maps errors to localized toasts.
 * A second call with the same key while the first is still running is ignored (double-click / double-Enter on money actions).
 */
export function useAction() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef<string[]>([]);
  async function run<T>(key: string, fn: () => Promise<T>, o: { success?: string; onDone?: (r: T) => void; onError?: (e: unknown) => void } = {}) {
    if (running.current.includes(key)) return;
    running.current.push(key); setBusy(key);
    try {
      const r = await fn();
      if (o.success) toast.success(t(o.success));
      o.onDone?.(r);
      return r;
    } catch (e) {
      toast.error(errText(e, t));
      o.onError?.(e);
    } finally {
      running.current = running.current.filter((k) => k !== key);
      setBusy(running.current[running.current.length - 1] ?? null);
    }
  }
  return { busy, run, is: (k: string) => busy === k, any: busy !== null };
}
