"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { UserRound, X } from "lucide-react";
import { Button, EmptyState, ErrorState, Input, SearchBox, Skeleton } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { qs, useDebounced } from "./admin-common";

/** Rows per page on every finance list. */
export const PAGE = 25;

/**
 * Several filters that live in the URL (`?status=hold&from=2026-11-01`), so dashboard tiles, notifications and copied links open a list already filtered.
 * Unlike `useUrlState` one call can change many keys at once (a "clear filters" reset), and it uses `history.replaceState` — which Next syncs into
 * `useSearchParams` — so a click updates at once without a server round trip. Empty values are removed. Needs a <Suspense> boundary above it.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const sp = useSearchParams();
  const values = {} as Record<K, string>;
  for (const k of keys) values[k] = sp.get(k) ?? "";
  const set = useCallback((patch: Partial<Record<K, string>>) => {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch) as Array<[string, string]>) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
  }, []);
  return [values, set] as const;
}

/** Money in `ltr-num` so the digits keep their order in Arabic / Urdu pages. */
export function Money({ c, className }: { c: number | null | undefined; className?: string }) {
  const { locale } = useI18n();
  return <span className={cn("ltr-num tabular-nums", className)}>{fmtMoney(c, locale)}</span>;
}

/** The entity page of a business / courier office / driver account (those owners build the pages; the links are part of the route map). */
export function partyHref(role: string | null | undefined, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return role === "business" ? `/admin/companies/${id}` : role === "office" ? `/admin/offices/${id}` : role === "driver" ? `/admin/drivers/${id}` : undefined;
}

/** A page the signed-in staff member may not open (the shell already blocks the sidebar areas; this covers a typed URL inside one). */
export { NoAccess } from "@/components/ui";

/** Placeholder rows while a list loads (keeps the toolbar and KPIs in place instead of a full-page spinner). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2.5 rounded-card border border-line bg-card p-4" aria-busy="true" role="status">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>;
}

/** The states every list has: failed (with retry), still loading, nothing to show (`emptyState`) — otherwise the children (the table). */
export function ListBody({ error, loaded, isEmpty, emptyState, retry, children }: { error: unknown; loaded: boolean; isEmpty: boolean; emptyState: ReactNode; retry: () => void; children: ReactNode }) {
  if (error) return <ErrorState error={error} retry={retry} />;
  if (!loaded) return <ListSkeleton />;
  return isEmpty ? <>{emptyState}</> : <>{children}</>;
}

/** "Nothing here" for a list: a hint, and a way out of the filters when some are on. */
export function NoRows({ title, hint, filtered, onReset, icon }: { title: string; hint?: string; filtered: boolean; onReset: () => void; icon?: ReactNode }) {
  const { t } = useI18n();
  return <EmptyState icon={icon} title={filtered ? t("common.no_results") : title} hint={filtered ? t("rdf.try_other_filters") : hint}
    action={filtered ? <Button variant="secondary" size="sm" onClick={onReset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button> : undefined} />;
}

/** From / to date pair for a toolbar. Values are `YYYY-MM-DD` (Riyadh days, converted with `dayStartIso` / `dayEndIso` by the caller). */
export function DateRangeFilter({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <label className="flex items-center gap-2 text-xs text-muted">{t("adm.from")}<span className="block w-40"><Input type="date" ltr value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} data-testid="fin-date-from" /></span></label>
      <label className="flex items-center gap-2 text-xs text-muted">{t("adm.to")}<span className="block w-40"><Input type="date" ltr value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} data-testid="fin-date-to" /></span></label>
    </>
  );
}

/** A removable filter shown as a pill (an account, a request …). */
export function FilterChip({ label, clearLabel, onClear, testid }: { label: ReactNode; clearLabel: string; onClear: () => void; testid?: string }) {
  return (
    <span data-testid={testid} className="inline-flex h-10 max-w-full items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 ps-3 pe-1 text-sm">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onClear} aria-label={clearLabel} title={clearLabel} className="jr-tap flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink"><X className="size-4" aria-hidden /></button>
    </span>
  );
}

const ACCOUNT_ROLES = ["business", "driver", "office"];
/**
 * Pick one account (business, driver or courier office) by typing part of the name or phone; shows the chosen one as a removable chip.
 * Needs `users.view` to search — without it nothing is rendered, but an account that came from the URL still shows as a chip.
 */
export function AccountFilter({ value, onChange, role, placeholder, clearLabel, testid }: { value: string; onChange: (id: string) => void; role?: "business" | "driver" | "office"; placeholder: string; clearLabel: string; testid?: string }) {
  const { t } = useI18n(); const me = useUser();
  const canSearch = hasPerm(me, "users.view");
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim(), 250);
  const box = useRef<HTMLDivElement>(null);
  const found = useApi(canSearch && !value && dq.length >= 2 ? `/admin/users${qs({ q: dq, role, pageSize: 8 })}` : null, { shouldRetryOnError: false });
  const known = useApi(canSearch && value ? `/admin/users/${value}` : null, { shouldRetryOnError: false });
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setQ(""); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, []);
  if (value) {
    const name = known.data?.profile?.companyName ?? known.data?.profile?.officeName ?? known.data?.user?.name ?? t("rdf.account_selected");
    return <FilterChip testid={testid} label={<span className="inline-flex items-center gap-1.5"><UserRound className="size-4 shrink-0 text-accent" aria-hidden />{name}</span>} clearLabel={clearLabel} onClear={() => onChange("")} />;
  }
  if (!canSearch) return null;
  const list = (found.data?.items ?? []).filter((u: any) => ACCOUNT_ROLES.includes(u.role));
  return (
    <div ref={box} data-testid={testid} className="relative w-full sm:w-64" onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}>
      <SearchBox value={q} onChange={setQ} placeholder={placeholder} label={placeholder} className="sm:w-full" />
      {dq.length >= 2 && (
        <ul role="listbox" aria-label={placeholder} className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-xl">
          {!found.data ? <li className="px-3 py-2 text-xs text-muted">{t("uxa.searching")}</li> : list.length === 0 ? <li className="px-3 py-2 text-xs text-muted">{t("common.no_results")}</li> : list.map((u: any) => (
            <li key={u.id}><button type="button" role="option" aria-selected="false" onClick={() => { onChange(u.id); setQ(""); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-bg2">
              <span className="truncate">{u.name}</span><span className="shrink-0 text-xs text-muted">{t(`role.${u.role}`)}</span></button></li>))}
        </ul>)}
    </div>
  );
}
