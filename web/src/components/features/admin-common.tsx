"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Modal, Segmented, Textarea, errText } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isDay, matchPeriod, periodRange, type PresetPeriod } from "./admin-ops-lib";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { riyadhLocalToIso } from "@/lib/format";
import type { Locale } from "@/i18n/core";
import { hasPerm } from "@/components/layout/auth-context";
import type { SessionUser } from "@/server/auth/current";

/** True when the signed-in user holds at least one of the permissions (admin holds all). */
export const hasAny = (u: SessionUser, ...perms: string[]) => perms.some((p) => hasPerm(u, p));

/** Query string from a record; empty / false / nullish values are dropped. */
export function qs(o: Record<string, string | number | boolean | null | undefined>) {
  const p = Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
}

/** Start of a Riyadh calendar day (inclusive lower bound) and the start of the next day (exclusive upper bound). */
export const dayStartIso = (d: string) => (d ? riyadhLocalToIso(`${d}T00:00`) : undefined);
export const dayEndIso = (d: string) => (d ? new Date(new Date(riyadhLocalToIso(`${d}T00:00`)).getTime() + 86_400_000).toISOString() : undefined);

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

/** Translation when the key exists, otherwise the raw value (so unknown enum values never show as a translation key). */
export function useTx() {
  const { t } = useI18n();
  return (key: string, raw: unknown) => {
    if (raw === null || raw === undefined || raw === "") return "—";
    const k = t(key);
    return k === key ? String(raw) : k;
  };
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <div className="w-40"><Input label={t("adm.from")} type="date" ltr value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} /></div>
      <div className="w-40"><Input label={t("adm.to")} type="date" ltr value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} /></div>
    </>
  );
}

/** Prev / next pager for endpoints that do not return a total. */
export function PrevNext({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage: (p: number) => void }) {
  const { t } = useI18n();
  if (page <= 1 && !hasNext) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>{t("adm.page_n", { page })}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("common.prev")}</Button>
        <Button variant="secondary" size="sm" disabled={!hasNext} onClick={() => onPage(page + 1)}>{t("common.next")}</Button>
      </div>
    </div>
  );
}

/** CSV of the rows currently on screen (formula-injection safe, UTF-8 BOM so Excel reads Arabic). */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const sar = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));

/** Modal asking for a reason / note before a sensitive action. */
export function ReasonModal(props: ReasonProps) { return props.open ? <ReasonInner {...props} /> : null; }
interface ReasonProps {
  open: boolean; title: string; label?: string; hint?: string; notice?: ReactNode; minLen?: number; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onClose: () => void; onSubmit: (reason: string) => void; children?: ReactNode;
}
function ReasonInner({ open, title, label, hint, notice, minLen = 3, confirmLabel, danger, busy, onClose, onSubmit, children }: ReasonProps) {
  const { t } = useI18n();
  const [v, setV] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant={danger ? "danger" : "primary"} loading={busy} disabled={v.trim().length < minLen} onClick={() => onSubmit(v.trim())}>{confirmLabel ?? t("common.confirm")}</Button></>}>
      {notice}
      {children}
      <Textarea label={label ?? t("req.reason")} hint={hint} value={v} onChange={(e) => setV(e.target.value)} />
    </Modal>
  );
}

/** Localized headline plus the server's specific sentence for validation / permission errors (e.g. which permission is missing). */
export function fullErr(e: unknown, t: (k: string, v?: Record<string, string | number>) => string) {
  const base = errText(e, t);
  if (e instanceof ApiError) {
    const missing = Array.isArray((e.details as { missing?: unknown }).missing) ? ` (${((e.details as { missing: string[] }).missing).join(", ")})` : "";
    if (e.code === "VALIDATION" && e.message && !base.includes(e.message)) return `${base} — ${e.message}`;
    return base + (missing && !base.includes(missing) ? missing : "");
  }
  return base;
}

/** "3 hours ago" style text for health lines (the exact Riyadh time is shown next to it by the caller). */
export function relTime(iso: string | Date | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  const tag = locale === "en" ? "en-GB" : locale === "ur" ? "ur-PK-u-nu-latn" : "ar-SA-u-nu-latn-ca-gregory";
  const sec = (new Date(iso).getTime() - Date.now()) / 1000; const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86400 * 60) return rtf.format(Math.round(sec / 86400), "day");
  return rtf.format(Math.round(sec / (86400 * 30)), "month");
}

/**
 * A parcel code looks like `<request ref>-<3 digit seq>` (JR-000012-007). The staff request search only matches the request ref,
 * so a pasted parcel code is split into the request ref (to find the request) and the code (to pre-filter the parcel list).
 */
export function splitParcelCode(raw: string): { ref: string; code: string } | null {
  const m = /^([A-Za-z]+-\d+)-(\d{1,4})$/.exec(raw.trim());
  return m ? { ref: m[1].toUpperCase(), code: raw.trim().toUpperCase() } : null;
}

/** Small copy-to-clipboard icon button (IBANs, references, codes). */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  return (
    <button type="button" aria-label={label} title={label} className="inline-flex rounded p-1 text-muted transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onClick={async () => { try { await navigator.clipboard.writeText(value); toast.success(t("common.copied")); } catch { toast.error(t("uxa.copy_failed")); } }}>
      <Copy className="size-3.5" aria-hidden />
    </button>
  );
}

/** Yes / no confirmation for actions that move money or lock someone out (replaces window.confirm, which is unstyled and not translated). */
export function ConfirmModal({ open, title, children, confirmLabel, danger, busy, onClose, onConfirm }: {
  open: boolean; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>{confirmLabel ?? t("common.confirm")}</Button></>}>
      {children}
    </Modal>
  );
}

/** Name of a business account (cached by SWR, so a table of many rules costs one request per distinct business). */
export function BusinessName({ id }: { id: string }) {
  const { t } = useI18n();
  const { data } = useApi(`/admin/users/${id}`, { shouldRetryOnError: false });
  const name = data?.profile?.companyName ?? data?.user?.name;
  return <Badge tone="info">{name ?? t("pricing.business")}</Badge>;
}

/**
 * Pick a business by typing part of its name or phone. Replaces "first 100 businesses" dropdowns, which silently hid everyone else.
 * Shows `placeholder` (e.g. "All businesses") when nothing is chosen.
 */
export function BusinessPicker({ label, value, onChange, placeholder }: { label: string; value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; placeholder?: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim());
  const found = useApi(!value && dq.length >= 2 ? `/admin/users${qs({ role: "business", q: dq, pageSize: 8 })}` : null, { shouldRetryOnError: false });
  if (value) {
    return (
      <div className="space-y-1.5"><p className="text-xs font-medium text-muted">{label}</p>
        <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 text-sm"><span className="truncate">{value.name}</span><Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>{t("common.edit")}</Button></div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Input label={label} placeholder={placeholder ?? t("uxa.biz_search_ph")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {dq.length >= 2 && (found.error ? <p className="text-xs text-danger">{errText(found.error, t)}</p> : !found.data ? <p className="text-xs text-muted">{t("uxa.searching")}</p> : found.data.items.length === 0 ? <p className="text-xs text-muted">{t("common.no_results")}</p> : (
        <ul className="max-h-40 space-y-1 overflow-y-auto" role="listbox" aria-label={label}>{found.data.items.map((u: any) => (
          <li key={u.id}><button type="button" role="option" aria-selected="false" className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-start text-sm hover:border-accent/60" onClick={() => { onChange({ id: u.id, name: u.name }); setQ(""); }}><span>{u.name}</span><span className="ltr-num text-xs text-muted">{u.phone ?? ""}</span></button></li>))}
        </ul>))}
    </div>
  );
}

// ───────── List-view helpers (redesign): toolbar dates, period filter, URL-synced filters, link buttons ─────────

/** Compact "From – To" date pair for a <Toolbar> (the labelled <DateRange> is for form-style filter bars). */
export function ToolbarDates({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  const one = (label: string, value: string, on: (v: string) => void, lim: { min?: string; max?: string }) => (
    <div className="flex items-center gap-2"><span className="text-xs text-muted" aria-hidden>{label}</span><div className="w-36"><Input aria-label={label} type="date" ltr value={value} {...lim} onChange={(e) => on(e.target.value)} /></div></div>
  );
  return <>{one(t("adm.from"), from, onFrom, { max: to || undefined })}{one(t("adm.to"), to, onTo, { min: from || undefined })}</>;
}

/** The `?page=` of a list: the current page (1-based) and a setter that keeps every other filter (page 1 is not written). Needs a <Suspense> boundary above it. */
export function useUrlPage(): [number, (p: number) => void] {
  const sp = useSearchParams(); const router = useRouter(); const path = usePathname();
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const set = useCallback((p: number) => {
    const q = new URLSearchParams(window.location.search);
    if (p > 1) q.set("page", String(p)); else q.delete("page");
    const s = q.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [path, router]);
  return [page, set];
}

/** The period filter of a list (`?from=&to=` in the URL, Riyadh days): the active preset, the raw days, setters, and the ISO bounds the API expects. */
export function usePeriodFilter() {
  const sp = useSearchParams(); const patch = useUrlPatch();
  const f = sp.get("from"), u = sp.get("to");
  const from = isDay(f) ? f : "", to = isDay(u) ? u : "";
  return {
    from, to, period: matchPeriod(from, to), active: !!(from || to),
    setPeriod: (k: PresetPeriod) => { const r = periodRange(k); patch({ from: r.from, to: r.to }); },
    setFrom: (v: string) => patch({ from: v }), setTo: (v: string) => patch({ to: v }),
    clear: () => patch({ from: "", to: "" }),
    range: { from: dayStartIso(from), to: dayEndIso(to) },
  };
}

/** Period presets (all time / today / 7 days / 30 days / this month) as a segmented control, followed by the custom From–To dates. */
export function PeriodBar({ p, label }: { p: ReturnType<typeof usePeriodFilter>; label?: string }) {
  const { t } = useI18n();
  const opts = [{ key: "", label: t("rda.period_all") }, { key: "today", label: t("rda.period_today") }, { key: "7d", label: t("rda.period_7d") }, { key: "30d", label: t("rda.period_30d") }, { key: "month", label: t("rda.period_month") }];
  return (
    <>
      <Segmented label={label ?? t("rda.period")} options={opts} value={p.period === "custom" ? "__custom" : p.period} onChange={(k) => p.setPeriod(k as PresetPeriod)} />
      <ToolbarDates from={p.from} to={p.to} onFrom={p.setFrom} onTo={p.setTo} />
    </>
  );
}

const LB_VARIANT = { primary: "bg-accent text-accent-ink hover:brightness-110 font-semibold", secondary: "border border-line bg-bg2 text-ink hover:border-accent/60 hover:bg-card", ghost: "text-muted hover:text-ink hover:bg-card" } as const;
/**
 * A link that looks like a <Button> (a button inside an <a> is invalid HTML). Internal paths use the router; `download` / `external` render a plain <a>
 * (CSV exports, API downloads).
 */
export function LinkButton({ href, children, variant = "secondary", size = "md", download, external, className, ...rest }: { href: string; children: ReactNode; variant?: keyof typeof LB_VARIANT; size?: "sm" | "md"; download?: boolean; external?: boolean; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className">) {
  const cls = cn("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl transition select-none", LB_VARIANT[variant], size === "sm" ? "h-8 px-3 text-xs pointer-coarse:h-10" : "h-10 px-4 text-sm", className);
  return download || external ? <a href={href} download={download || undefined} className={cls} {...rest}>{children}</a> : <Link href={href} className={cls} {...rest}>{children}</Link>;
}

/** City keys → names in the current language (the catalog is editable in Settings, so a key may have no built-in translation). `cities` feeds a city filter. */
export function useCityNames() {
  const { t, locale } = useI18n();
  const cat = useApi<{ cities: Array<Record<string, any>> }>("/catalog");
  const cities = cat.data?.cities ?? [];
  const map = new Map(cities.map((c) => [c.key as string, (c[locale] ?? c.key) as string]));
  const name = (key: string | null | undefined) => {
    if (!key) return "—";
    const hit = map.get(key); if (hit) return hit;
    const k = t(`city.${key}`); return k === `city.${key}` ? key : k;
  };
  return { name, cities: cities.map((c) => ({ value: c.key as string, label: (c[locale] ?? c.key) as string })) };
}
