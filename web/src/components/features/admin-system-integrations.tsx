"use client";
import { Suspense, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plug, Plus, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi, useUrlPatch, useUrlState } from "@/components/ui/data";
import { ApiError, get } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import type { Mode, Provider } from "./business-shipments-partner";
import { hasAny, qs, relTime, useDebounced } from "./admin-common";
import { connectionFilter, entityHref, healthOf, type Conn, type Health } from "./admin-system-lib";
import { adminScope, connRoute, type FreshView } from "./partner-conn-lib";
import { ModeBadge, providerName } from "./partner-conn-parts";
import { AddConnectionDialog } from "./partner-conn-add";
import { FreshTokenCard } from "./partner-conn-fresh";
import { canManageIntegrations, canViewIntegrations } from "./partner-conn-admin";

const SIZE = 25;
type Row = Conn & { mode?: Mode | null; orders?: { open: number; inJr: number } };
type Page = { items: Row[]; total: number };

/**
 * Warehouse-system connections of every business (`/admin/integrations`): health KPIs, view filter (`?view=problems`, legacy `?problems=1`), search +
 * system filter (`?businessId=` narrows to one company). Each row opens the connection's own view (`/admin/integrations/:id`); staff with
 * `integrations.manage` can add a connection for a company.
 */
export function IntegrationsConsole() { return <Suspense fallback={<PageLoading />}><IntegrationsInner /></Suspense>; }

function IntegrationsInner() {
  const { t, locale } = useI18n(); const me = useUser(); const sp = useSearchParams(); const router = useRouter();
  const [view, setView] = useUrlState("view", sp.get("problems") === "1" ? "problems" : "all"); const [provider, setProvider] = useUrlState("provider");
  const businessId = sp.get("businessId") ?? "";
  const patchUrl = useUrlPatch();
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false); const [fresh, setFresh] = useState<FreshView | null>(null);
  const allowed = canViewIntegrations(me); const manage = canManageIntegrations(me);
  const scope = adminScope(manage);
  const list = useApi<Page>(allowed ? `/admin/partners${qs({ ...connectionFilter(view), provider, q: dq, businessId, page, pageSize: SIZE })}` : null, { refreshInterval: 60000, keepPreviousData: true, shouldRetryOnError: false });
  const catalogue = useApi<{ items: Provider[] }>(allowed && (adding || !!fresh) ? "/integrations/providers" : null);
  // KPIs: three small requests — all connections (also the source of the system filter), the switched-on count, and the switched-on connections with a problem (their stuck updates are summed).
  const kpi = useSWR(allowed ? "rdb-partners-kpi" : null, async () => {
    const [all, on, bad] = await Promise.all([get<Page>("/admin/partners?pageSize=200"), get<Page>("/admin/partners?status=active&pageSize=1"), get<Page>("/admin/partners?status=active&problemsOnly=1&pageSize=200")]);
    return { total: all.total, active: on.total, problems: bad.total, stuck: bad.items.reduce((n, c) => n + c.stuckUpdates, 0), stuckCapped: bad.total > bad.items.length,
      providers: [...new Map(all.items.map((c) => [c.provider, c.providerLabel])).entries()].map(([value, label]) => ({ value, label })) };
  }, { refreshInterval: 60000, shouldRetryOnError: false });
  if (!allowed) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  if (list.error && !list.data) return <ErrorState error={list.error} retry={() => list.mutate()} />;
  const k = kpi.data; const canBiz = hasAny(me, "users.view", "offices.view", "verification.manage");
  const filtered = !!(dq || provider || businessId || view !== "all");
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const providers = [...(k?.providers ?? []), ...(provider && !k?.providers.some((p) => p.value === provider) ? [{ value: provider, label: provider }] : [])];
  const badge: Record<Health, { tone: "success" | "danger" | "neutral" | "warn"; label: string }> = {
    ok: { tone: "success", label: t("pa.health_ok") }, attention: { tone: "danger", label: t("pa.health_attention") }, new: { tone: "warn", label: t("pa.health_new") }, paused: { tone: "neutral", label: t("pa.health_paused") },
  };
  const when = (iso: string | null) => <span title={fmtDateTime(iso, locale)}>{relTime(iso, locale)}</span>;
  const options = [{ key: "all", label: t("common.all"), count: k?.total }, { key: "problems", label: t("pa.stat_attention"), count: k?.problems }, { key: "active", label: t("pa.status_active"), count: k?.active }, { key: "disabled", label: t("pa.status_disabled"), count: k ? k.total - k.active : undefined }];
  const refresh = () => { void list.mutate(); void kpi.mutate(); };

  return (
    <>
      <PageHeader title={t("nav.integrations")} subtitle={t("pa.sub")} icon={<Plug className="size-5" />}
        actions={<>
          <Button variant="secondary" loading={list.isValidating || kpi.isValidating} onClick={refresh}><RefreshCw className="size-4" aria-hidden />{t("pa.refresh")}</Button>
          {manage && <Button onClick={() => setAdding(true)} data-testid="admin-add-connection"><Plus className="size-4" aria-hidden />{t("iv2.add_for_company")}</Button>}
        </>} />
      {fresh && (
        <FreshTokenCard fresh={fresh} provider={catalogue.data?.items.find((p) => p.key === fresh.conn.provider)} scope={scope} onChanged={refresh} doneLabel={t("iv2.saved_open")}
          onDone={() => { const id = fresh.conn.id; setFresh(null); router.push(connRoute(scope, id)); }} />
      )}
      {list.error && <div className="mb-4"><Notice tone="warn">{t("pa.stale")}</Notice></div>}
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("pa.stat_total")} value={k ? k.total : 0} loading={!k} tone="muted" icon={<Plug className="size-5" aria-hidden />} href="/admin/integrations" hint={k ? t("rdb.int_on_hint", { n: k.active }) : undefined} />
        <Stat label={t("rdb.int_healthy")} value={k ? k.active - k.problems : 0} loading={!k} icon={<CheckCircle2 className="size-5" aria-hidden />} href="/admin/integrations?view=active" hint={t("rdb.int_healthy_hint")} />
        <Stat label={t("pa.stat_attention")} value={k ? k.problems : 0} loading={!k} tone={k?.problems ? "danger" : "muted"} icon={<AlertTriangle className="size-5" aria-hidden />} href="/admin/integrations?view=problems" hint={t("rdb.int_problem_hint")} />
        <Stat label={t("pa.stat_stuck")} value={k ? `${k.stuck}${k.stuckCapped ? "+" : ""}` : 0} loading={!k} tone={k?.stuck ? "danger" : "muted"} icon={<Unplug className="size-5" aria-hidden />} hint={t("pa.stuck_hint")} />
      </StatGrid>

      <Toolbar><Segmented label={t("common.status")} value={view} onChange={reset(setView)} options={options} /></Toolbar>
      <Toolbar>
        <SearchBox value={q} onChange={reset(setQ)} placeholder={t("pa.search_ph")} label={t("common.search")} />
        <div className="w-52"><Select data-testid="rdb-int-provider" aria-label={t("pa.provider")} placeholder={t("rdb.int_provider_any")} options={providers} value={provider} onChange={(e) => reset(setProvider)(e.target.value)} /></div>
        {businessId && <Button variant="ghost" size="sm" onClick={() => patchUrl({ businessId: "" })} data-testid="int-company-filter">{t("iv2.one_company")} ×</Button>}
      </Toolbar>

      {!list.data ? <PageLoading /> : list.data.items.length === 0 ? (
        <EmptyState icon={<Plug className="size-9" aria-hidden />} title={filtered ? t("common.no_results") : t("pa.empty")} hint={filtered ? undefined : t("pa.empty_hint")}
          action={filtered ? <Button variant="secondary" size="sm" onClick={() => { setQ(""); patchUrl({ provider: "", view: "", problems: "", businessId: "" }); setPage(1); }}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : (
        <>
          <Table stack label={t("nav.integrations")} head={[t("role.business"), t("pa.connection"), t("common.status"), t("pa.health"), { label: t("pa.stuck"), align: "end" }]}>
            {list.data.items.map((c) => {
              const h = healthOf(c); const href = canBiz ? entityHref("business", c.businessId) : null;
              const pn = providerName(t, c.provider, c.providerLabel);
              return (
                <tr key={c.id} data-testid={`rdb-int-row-${c.id}`} className={h === "attention" ? "bg-danger/[0.05] align-top" : "align-top"}>
                  <Td label={t("role.business")}><CellPair title={c.business} href={href ?? undefined} /></Td>
                  <Td label={t("pa.connection")}>
                    <CellPair title={<span data-testid={`int-open-${c.id}`}>{c.name}</span>} href={connRoute(scope, c.id)} sub={`${pn} · ${t("pa.since", { d: fmtDateTime(c.createdAt, locale) })}`} />
                    <div className="mt-1 flex flex-wrap items-center gap-1.5"><ModeBadge mode={c.mode} name={pn} />{(c.orders?.open ?? 0) > 0 && <Badge tone="info">{t("iv2.open_orders_n", { n: c.orders!.open })}</Badge>}</div>
                  </Td>
                  <Td label={t("common.status")}><Badge tone={badge[h].tone}>{badge[h].label}</Badge><p className="mt-1 text-xs text-muted">{c.status === "active" ? t("pa.status_active") : t("pa.status_disabled")}</p></Td>
                  <Td label={t("pa.health")} className="max-w-80 space-y-0.5 text-xs">
                    <p className="text-muted">{c.lastOkAt ? <>{t("pa.last_ok")}: {when(c.lastOkAt)}</> : t("pa.never_ok")}</p>
                    {c.lastError && <p className="break-words text-danger" title={c.lastError}>{t("pa.last_error")}: {c.lastError.length > 140 ? `${c.lastError.slice(0, 140)}…` : c.lastError}{c.lastCheckedAt ? <span className="text-muted"> ({when(c.lastCheckedAt)})</span> : null}</p>}
                    <p className="text-muted">{c.lastEventAt ? <>{t("pa.last_event")}: {when(c.lastEventAt)}</> : t("pa.no_events")}</p>
                  </Td>
                  <Td label={t("pa.stuck")} align="end">{c.stuckUpdates > 0
                    ? <><Badge tone={c.status === "active" ? "danger" : "warn"}><AlertTriangle className="size-3" aria-hidden />{t("pa.stuck_n", { n: c.stuckUpdates })}</Badge><p className="mt-1 max-w-40 text-xs text-muted sm:ms-auto">{t("pa.stuck_action")}</p></>
                    : <span className="ltr-num text-muted">0</span>}</Td>
                </tr>);
            })}
          </Table>
          <Pagination page={page} total={list.data.total} pageSize={SIZE} onPage={setPage} />
          <p className="mt-2 text-xs text-muted" aria-live="polite">{t("pa.showing", { n: list.data.items.length, total: list.data.total })}</p>
        </>
      )}
      <p className="mt-4 text-xs text-muted">{manage ? t("iv2.admin_note_manage") : t("iv2.admin_note_view")}</p>
      {adding && (catalogue.data
        ? <AddConnectionDialog providers={catalogue.data.items} scope={scope} pickCompany onClose={() => setAdding(false)}
            onCreated={(c, creds) => { setAdding(false); refresh(); if (creds) setFresh({ conn: c, creds, kind: "created" }); else router.push(connRoute(scope, c.id)); }} />
        : catalogue.error ? <div className="mt-4"><ErrorState error={catalogue.error} retry={() => catalogue.mutate()} /></div> : null)}
    </>
  );
}
