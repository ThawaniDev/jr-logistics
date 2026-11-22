"use client";
import { Suspense, useMemo, useState } from "react";
import useSWR from "swr";
import { Activity, CalendarDays, ScrollText, Settings2, Users } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, KV, Modal, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, Table, Td, Toolbar, NoAccess } from "@/components/ui";
import { useApi, useUrlPatch, useUrlState } from "@/components/ui/data";
import { get } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { CopyButton, qs, useDebounced, useTx } from "./admin-common";
import { AUDIT_ENTITIES, actionParts, auditFrom, diffRows, distinctActors, riyadhDayStart } from "./admin-system-lib";

const SIZE = 50;
const PERIODS = ["all", "today", "7d", "30d"] as const;

interface Entry { id: string; actorId: string | null; actorName: string | null; actorRole: string | null; action: string; entity: string; entityId: string | null; diff: unknown; ip?: string | null; correlationId?: string | null; createdAt: string }

/** Before / after table of a settings change, or the raw JSON for any other entry. */
function DiffView({ diff }: { diff: unknown }) {
  const { t } = useI18n(); const rows = diffRows(diff);
  if (rows) return (
    <table className="w-full text-xs" dir="ltr"><thead className="text-muted"><tr><th className="py-1 text-start font-medium">{t("rdb.au_field")}</th><th className="py-1 text-start font-medium">{t("rdb.au_from")}</th><th className="py-1 text-start font-medium">{t("rdb.au_to")}</th></tr></thead>
      <tbody className="divide-y divide-line/60">{rows.map((r) => <tr key={r.key} className="align-top"><td className="py-1.5 pe-3 font-medium">{r.key}</td><td className="break-all py-1.5 pe-3 text-muted">{r.from}</td><td className="break-all py-1.5 text-accent">{r.to}</td></tr>)}</tbody></table>
  );
  return <pre dir="ltr" className="max-h-72 overflow-auto rounded-xl bg-bg2 p-3 text-start text-xs">{diff ? JSON.stringify(diff, null, 2) : "—"}</pre>;
}

/** Immutable record of sensitive actions (`/admin/audit`): activity KPIs, period / entity / action filters, who-did-what table and an entry viewer. */
export function AuditConsole() { return <Suspense fallback={<PageLoading />}><AuditInner /></Suspense>; }

function AuditInner() {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser();
  const [period, setPeriod] = useUrlState("period", "all"); const [entity, setEntity] = useUrlState("entity"); const [action, setAction] = useUrlState("action");
  const patchUrl = useUrlPatch();
  const [actionQ, setActionQ] = useState(action); const dq = useDebounced(actionQ.trim());
  const [page, setPage] = useState(1); const [view, setView] = useState<Entry | null>(null);
  const day = useMemo(() => riyadhDayStart(), []);
  const allowed = hasPerm(me, "audit.view");
  const act = action || dq;
  const from = auditFrom(period);
  const { data, error, mutate } = useApi<{ items: Entry[]; total: number }>(allowed ? `/admin/audit${qs({ entity, action: act, from, page, pageSize: SIZE })}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  const kpi = useSWR(allowed ? ["rdb-audit-kpi", day] : null, async () => {
    const q = (o: Record<string, string | number | undefined>) => get<{ items: Entry[]; total: number }>(`/admin/audit${qs(o)}`);
    const [today, week, who, settings, staff] = await Promise.all([q({ from: day, pageSize: 1 }), q({ from: auditFrom("7d"), pageSize: 1 }), q({ from: day, pageSize: 200 }), q({ from: day, action: "settings.", pageSize: 1 }), q({ from: day, action: "staff.", pageSize: 1 })]);
    return { today: today.total, week: week.total, people: distinctActors(who.items), peopleCapped: who.total > who.items.length, changes: settings.total + staff.total };
  }, { refreshInterval: 60_000, shouldRetryOnError: false });
  if (!allowed) return <NoAccess />;
  const k = kpi.data; const filtered = !!(entity || act || period !== "all");
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const clear = () => { patchUrl({ period: "", entity: "", action: "" }); setActionQ(""); setPage(1); };
  const who = (a: Entry) => a.actorName ?? (a.actorRole ? tx(`role.${a.actorRole}`, a.actorRole) : "—");

  return (
    <>
      <PageHeader title={t("nav.audit")} subtitle={t("audit.sub")} icon={<ScrollText className="size-5" />} />
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("rdb.au_today")} value={k ? k.today : 0} loading={!k} icon={<Activity className="size-5" aria-hidden />} href="/admin/audit?period=today" hint={t("rdb.au_today_hint")} />
        <Stat label={t("rdb.au_week")} value={k ? k.week : 0} loading={!k} tone="cyan" icon={<CalendarDays className="size-5" aria-hidden />} href="/admin/audit?period=7d" hint={t("rdb.au_week_hint")} />
        <Stat label={t("rdb.au_people")} value={k ? `${k.people}${k.peopleCapped ? "+" : ""}` : 0} loading={!k} tone="muted" icon={<Users className="size-5" aria-hidden />} hint={t("rdb.au_people_hint")} />
        <Stat label={t("rdb.au_changes")} value={k ? k.changes : 0} loading={!k} tone={k?.changes ? "gold" : "muted"} icon={<Settings2 className="size-5" aria-hidden />} hint={t("rdb.au_changes_hint")} />
      </StatGrid>

      <Toolbar><Segmented label={t("rdb.au_period")} value={period} onChange={reset(setPeriod)} options={PERIODS.map((p) => ({ key: p, label: t(`rdb.au_p_${p}`) }))} /></Toolbar>
      <Toolbar>
        <div className="w-full sm:w-64"><SearchBox value={actionQ} onChange={(v) => { setActionQ(v); if (action) setAction(""); setPage(1); }} placeholder={t("rdb.au_action_ph")} label={t("audit.action")} className="sm:w-64" /></div>
        <div className="w-52"><Select aria-label={t("audit.entity")} placeholder={t("rdb.au_entity_any")} value={entity} onChange={(e) => reset(setEntity)(e.target.value)} options={[...AUDIT_ENTITIES, ...(entity && !(AUDIT_ENTITIES as readonly string[]).includes(entity) ? [entity] : [])].map((v) => ({ value: v, label: v }))} /></div>
      </Toolbar>

      {error && !data ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-9" aria-hidden />} title={filtered ? t("common.no_results") : t("rdb.au_none")} action={filtered ? <Button variant="secondary" size="sm" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack label={t("nav.audit")} head={[t("common.date"), t("rdb.au_who"), t("audit.action"), t("audit.entity"), t("audit.details"), { label: t("uxa.audit_view"), srOnly: true }]}>
          {data.items.map((a) => {
            const { area, verb } = actionParts(a.action); const rows = diffRows(a.diff);
            return (
              <tr key={a.id} data-testid={`rdb-audit-${a.id}`} onClick={() => setView(a)} className="cursor-pointer">
                <Td label={t("common.date")} className="whitespace-nowrap text-xs text-muted">{fmtDateTime(a.createdAt, locale)}</Td>
                <Td label={t("rdb.au_who")}><CellPair title={who(a)} sub={a.actorName && a.actorRole ? tx(`role.${a.actorRole}`, a.actorRole) : undefined} /></Td>
                <Td label={t("audit.action")}><span dir="ltr" className="inline-flex flex-wrap items-center gap-1.5"><Badge tone="neutral">{area}</Badge>{verb && <span className="font-medium">{verb}</span>}</span></Td>
                <Td label={t("audit.entity")} className="ltr-num text-muted">{a.entity}{a.entityId ? ` · ${String(a.entityId).slice(0, 8)}` : ""}</Td>
                <Td label={t("audit.details")} className="ltr-num max-w-xs text-xs text-muted"><span className="block truncate" title={a.diff ? JSON.stringify(a.diff) : undefined}>{rows ? rows.slice(0, 2).map((r) => `${r.key}: ${r.from} → ${r.to}`).join(" · ") : a.diff ? JSON.stringify(a.diff) : ""}</span></Td>
                <Td align="end"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setView(a); }}>{t("uxa.audit_view")}</Button></Td>
              </tr>);
          })}
        </Table>
        <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
        <p className="mt-2 text-xs text-muted">{t("uxa.total_n", { n: data.total })}</p>
      </>}

      <Modal open={!!view} onClose={() => setView(null)} title={view ? view.action : ""} footer={<Button variant="ghost" onClick={() => setView(null)}>{t("common.close")}</Button>}>
        {view && <>
          <dl>
            <KV label={t("common.date")}>{fmtDateTime(view.createdAt, locale)}</KV>
            <KV label={t("rdb.au_who")}>{who(view)}</KV>
            <KV label={t("common.role")}>{view.actorRole ? tx(`role.${view.actorRole}`, view.actorRole) : "—"}</KV>
            <KV label={t("uxa.audit_actor_id")}><span className="ltr-num text-xs">{view.actorId ?? "—"}</span></KV>
            <KV label={t("audit.entity")}><span className="ltr-num">{view.entity}</span></KV>
            <KV label={t("uxa.audit_entity_id")}><span className="ltr-num text-xs">{view.entityId ?? "—"}</span>{view.entityId && <CopyButton value={view.entityId} label={t("uxa.copy_id")} />}</KV>
            {view.ip && <KV label="IP"><span className="ltr-num">{view.ip}</span></KV>}
            {view.correlationId && <KV label={t("uxa.audit_correlation")}><span className="ltr-num text-xs">{view.correlationId}</span></KV>}
          </dl>
          <div><p className="mb-1 text-xs font-medium text-muted">{t("audit.details")}</p><DiffView diff={view.diff} /></div>
        </>}
      </Modal>
    </>
  );
}
