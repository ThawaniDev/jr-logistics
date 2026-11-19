"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, Flame, Gavel, Inbox, WalletCards } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td, Toolbar } from "@/components/ui";
import { useUrlPatch, useUrlState } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { relTime, useDebounced } from "./admin-common";
import { HandlerCell, RoleBadge, UrgentBadge } from "./admin-system-common";
import { useAssignees, useCaseList, useQueue } from "./admin-system-data";
import { complaintStats, isUrgent } from "./admin-system-lib";

const SIZE = 25;

/** Complaints queue (`/admin/complaints`): KPI row, status filter with counts, filters, and a table that opens the complaint view. */
export function ComplaintsConsole() { return <Suspense fallback={<PageLoading />}><ComplaintsList /></Suspense>; }

function ComplaintsList() {
  const { t, locale } = useI18n(); const me = useUser(); const router = useRouter(); const sp = useSearchParams();
  const [status, setStatus] = useUrlState("status", "active"); const [priority, setPriority] = useUrlState("priority"); const [assignee, setAssignee] = useUrlState("assignee"); const [hold, setHold] = useUrlState("hold");
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const patchUrl = useUrlPatch();
  const queue = useQueue("complaints"); const people = useAssignees("complaints");
  const list = useCaseList("complaints", { status, priority, role: "", assignee, hold, q: dq, page }, SIZE);
  if (!hasPerm(me, "complaints.manage")) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  const qd = queue.data; const st = qd ? complaintStats(qd) : null;
  const more = (n: number) => (st?.capped ? `${n}+` : n);
  const f = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const filtered = !!(dq || priority || assignee || hold || status !== "active");
  const clear = () => { setQ(""); patchUrl({ priority: "", assignee: "", hold: "", status: "" }); setPage(1); };
  const closed = qd?.closed?.total; const resolved = qd?.resolved?.total;
  const tab = (key: string, label: string, count?: number) => ({ key, label, count });
  const options = [tab("active", t("rdb.cs_active"), st?.active), tab("open", t("status.open"), st?.open), tab("in_progress", t("status.in_progress"), st?.inProgress), tab("resolved", t("status.resolved"), resolved), tab("closed", t("status.closed"), closed),
    tab("all", t("common.all"), st && resolved !== undefined && closed !== undefined ? st.active + resolved + closed : undefined)];
  const none = !!qd && !filtered && (st?.active ?? 0) + (resolved ?? 0) + (closed ?? 0) === 0;

  return (
    <>
      <PageHeader title={t("nav.complaints")} subtitle={t("rdb.cmp_sub")} icon={<Gavel className="size-5" />} />
      <StatGrid cols={5} className="mb-6">
        <Stat label={t("status.open")} value={st ? st.open : 0} loading={!st} icon={<Inbox className="size-5" aria-hidden />} href="/admin/complaints?status=open" hint={t("rdb.cmp_k_open_hint")} />
        <Stat label={t("status.in_progress")} value={st ? st.inProgress : 0} loading={!st} tone="cyan" icon={<Clock className="size-5" aria-hidden />} href="/admin/complaints?status=in_progress" hint={t("rdb.cmp_k_work_hint")} />
        <Stat label={t("complaints.holds_settlement")} value={st ? more(st.holding) : 0} loading={!st} tone={st?.holding ? "gold" : "muted"} icon={<WalletCards className="size-5" aria-hidden />} href="/admin/complaints?hold=1" hint={t("rdb.cmp_k_hold_hint")} />
        <Stat label={t("rdb.k_urgent")} value={st ? more(st.urgent) : 0} loading={!st} tone={st?.urgent ? "danger" : "muted"} icon={<Flame className="size-5" aria-hidden />} href="/admin/complaints?priority=urgent" hint={t("rdb.cmp_k_urgent_hint")} />
        <Stat label={t("rdb.k_resolved_week")} value={st ? st.resolvedWeek : 0} loading={!st} tone="muted" icon={<CheckCircle2 className="size-5" aria-hidden />} href="/admin/complaints?status=resolved" hint={t("rdb.k_resolved_week_hint")} />
      </StatGrid>

      <Toolbar><Segmented label={t("common.status")} value={status} onChange={f(setStatus)} options={options} /></Toolbar>
      <Toolbar>
        <div data-testid="complaints-filter-q" className="contents"><SearchBox value={q} onChange={f(setQ)} placeholder={t("rdb.cmp_search_ph")} label={t("common.search")} /></div>
        <div className="w-40"><Select data-testid="complaints-filter-priority" aria-label={t("foa.case_priority")} placeholder={t("rdb.priority_all")} value={priority} onChange={(e) => f(setPriority)(e.target.value)} options={[{ value: "urgent", label: t("support.urgent") }, { value: "normal", label: t("foa.case_priority_normal") }]} /></div>
        <div className="w-48"><Select data-testid="complaints-filter-assignee" aria-label={t("adm.handler")} placeholder={t("rdb.assignee_any")} value={assignee} onChange={(e) => f(setAssignee)(e.target.value)}
          options={[{ value: "me", label: t("rdb.assignee_me") }, { value: "unassigned", label: t("adm.unassigned") }, ...people.people.filter((p) => p.id !== me.id).map((p) => ({ value: p.id, label: p.name }))]} /></div>
        <div className="w-48"><Select data-testid="complaints-filter-hold" aria-label={t("complaints.holds_settlement")} placeholder={t("rdb.hold_any")} value={hold} onChange={(e) => f(setHold)(e.target.value)} options={[{ value: "1", label: t("complaints.holds_settlement") }]} /></div>
      </Toolbar>

      {list.error && !list.rows.length ? <ErrorState error={list.error} retry={list.reload} /> : list.loading ? <PageLoading /> : list.rows.length === 0 ? (
        none ? <EmptyState icon={<Gavel className="size-9" aria-hidden />} title={t("rdb.cmp_none")} hint={t("rdb.cmp_none_hint")} />
          : <EmptyState icon={<Gavel className="size-9" aria-hidden />} title={t("common.no_results")} hint={filtered ? t("rdb.cases_filtered_hint") : undefined} action={filtered ? <Button variant="secondary" size="sm" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack label={t("nav.complaints")} head={[t("rdb.cmp_col"), t("rdb.cmp_filed_by"), t("adm.handler"), t("common.status"), t("rdb.updated"), { label: t("rdb.open_case"), srOnly: true }]}>
          {list.rows.map((x) => (
            <tr key={x.id} data-testid={`complaints-row-${x.id}`} onClick={() => router.push(`/admin/complaints/${x.id}`)} className={isUrgent(x) ? "cursor-pointer bg-danger/[0.04]" : "cursor-pointer"}>
              <Td label={t("rdb.cmp_col")}><CellPair title={t(`complaint_cat.${x.category}`)} href={`/admin/complaints/${x.id}`} sub={<><span className="ltr-num">{x.ref}</span> · {x.description}</>} className="max-w-72" /></Td>
              <Td label={t("rdb.cmp_filed_by")}><CellPair title={x.filedByName ?? "—"} sub={<RoleBadge role={x.filedByRole} />} /></Td>
              <Td label={t("adm.handler")} className="text-sm"><HandlerCell id={x.handlerId} name={people.nameOf(x.handlerId)} /></Td>
              <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={x.status} />{isUrgent(x) && <UrgentBadge />}{x.holdsSettlement && <Badge tone="warn">{t("complaints.holds_settlement")}</Badge>}</span></Td>
              <Td label={t("rdb.updated")} className="whitespace-nowrap text-xs text-muted"><span title={fmtDateTime(x.updatedAt, locale)}>{relTime(x.updatedAt, locale)}</span></Td>
              <Td align="end" className="w-10"><ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden /></Td>
            </tr>))}
        </Table>
        {list.capped && <p className="mt-3 text-xs text-muted">{t("rdb.cases_capped", { n: 500 })}</p>}
        <Pagination page={page} total={list.total} pageSize={SIZE} onPage={setPage} />
        <p className="mt-2 text-xs text-muted">{t("uxa.total_n", { n: list.total })}</p>
      </>}
    </>
  );
}
