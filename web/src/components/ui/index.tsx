"use client";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, X, Inbox, AlertTriangle } from "lucide-react";
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
const SIZE = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" } as const;
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE; loading?: boolean; full?: boolean }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "primary", size = "md", loading, full, className, children, disabled, ...p }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} className={cn("inline-flex items-center justify-center gap-2 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed select-none", VARIANT[variant], SIZE[size], full && "w-full", className)} {...p}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  );
});

// ───────── Fields ─────────
const inputCls = "w-full rounded-xl border border-line bg-bg2 px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60 aria-[invalid=true]:border-danger";
export function Field({ label, error, hint, children, required }: { label?: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; required?: boolean }) {
  const id = useId();
  const dId = error || hint ? `${id}-d` : undefined;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={id} className="block text-xs font-medium text-muted">{label}{required && <span className="text-accent"> *</span>}</label>}
      {children(id, dId)}
      {error ? <p id={dId} role="alert" className="text-xs text-danger">{error}</p> : hint ? <p id={dId} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
interface InProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; hint?: string; ltr?: boolean }
export const Input = forwardRef<HTMLInputElement, InProps>(function Input({ label, error, hint, ltr, className, required, ...p }, ref) {
  return <Field label={label} error={error} hint={hint} required={required}>{(id, d) => <input ref={ref} id={id} aria-invalid={!!error} aria-describedby={d} required={required} dir={ltr ? "ltr" : undefined} className={cn(inputCls, "h-10", ltr && "text-start", className)} {...p} />}</Field>;
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
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Stat({ label, value, hint, tone = "accent", icon }: { label: string; value: ReactNode; hint?: string; tone?: "accent" | "cyan" | "gold" | "muted" | "danger"; icon?: ReactNode }) {
  const c = { accent: "text-accent", cyan: "text-cyan", gold: "text-gold", muted: "text-ink", danger: "text-danger" }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{icon && <span className={c}>{icon}</span>}</div>
      <div className={cn("mt-2 text-2xl font-bold tabular-nums", c)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
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
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("size-5 animate-spin text-accent", className)} aria-label="loading" />;
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-xl bg-line/50", className)} />;
export function PageLoading() {
  return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-56" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-64" /></div>;
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
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="jr-modal" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="font-semibold">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Close"><X className="size-5" /></button></div>
          <div className="space-y-4 px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ───────── Table ─────────
export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-bg2 text-xs uppercase tracking-wide text-muted"><tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-3 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>{t("common.page_of", { page, pages })}</span>
      <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("common.prev")}</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("common.next")}</Button></div>
    </div>
  );
}
export function Tabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: string; count?: number }>; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((x) => (
        <button key={x.key} role="tab" aria-selected={value === x.key} onClick={() => onChange(x.key)} className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition", value === x.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink")}>
          {x.label}{x.count != null && <span className="ms-1.5 rounded-full bg-bg2 px-1.5 text-xs">{x.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="steps">
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
  return <div className="flex items-start justify-between gap-4 py-2 text-sm"><dt className="text-muted">{label}</dt><dd className="text-end font-medium">{children}</dd></div>;
}

// ───────── Errors & actions ─────────
export function errText(e: unknown, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (e instanceof ApiError) {
    const m = t(`err.${e.code}`);
    return m.startsWith("err.") ? e.message : m;
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
/** Runs an async action with loading state; maps errors to localized toasts. */
export function useAction() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, o: { success?: string; onDone?: (r: T) => void; onError?: (e: unknown) => void } = {}) {
    setBusy(key);
    try {
      const r = await fn();
      if (o.success) toast.success(t(o.success));
      o.onDone?.(r);
      return r;
    } catch (e) {
      toast.error(errText(e, t));
      o.onError?.(e);
    } finally { setBusy(null); }
  }
  return { busy, run, is: (k: string) => busy === k, any: busy !== null };
}
