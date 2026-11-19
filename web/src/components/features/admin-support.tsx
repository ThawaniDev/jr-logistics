"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, Flame, Inbox, LifeBuoy, UserX } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td, CellPair, Toolbar } from "@/components/ui";
import { useUrlPatch, useUrlState } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { relTime, useDebounced } from "./admin-common";
import { HandlerCell, RoleBadge, UrgentBadge } from "./admin-system-common";
import { useAssignees, useCaseList, useQueue } from "./admin-system-data";
import { caseStats, isUrgent } from "./admin-system-lib";

const SIZE = 25;
const OPENER_ROLES = ["business", "driver", "office"] as const;

/** Staff ticket queue (`/admin/cases`): KPI row, status filter with counts, search + priority / opener / assignee filters, and a table that opens the case view. */
export function CasesConsole() {
  return <Suspense fallback={<PageLoading />}><CasesList /></Suspense>;
}

function CasesList() {
  const { t, locale } = useI18n(); const me = useUser(); const router = useRouter(); const sp = useSearchParams();
  const [status, setStatus] = useUrlState("status", "active"); const [priority, setPriority] = useUrlState("priority"); const [role, setRole] = useUrlState("role"); const [assignee, setAssignee] = useUrlState("assignee");
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const patchUrl = useUrlPatch();
  const queue = useQueue("tickets"); const people = useAssignees("tickets");
  const list = useCaseList("tickets", { status, priority, role, assignee, hold: "", q: dq, page }, SIZE);
  if (!hasPerm(me, "tickets.view")) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  const st = queue.data ? caseStats(queue.data) : null; const qd = queue.data;
  const more = (n: number) => (st?.capped ? `${n}+` : n);
  const f = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const filtered = !!(dq || priority || role || assignee || status !== "active");
  const clear = () => { setQ(""); patchUrl({ priority: "", role: "", assignee: "", status: "" }); setPage(1); };
  const resolvedTotal = qd?.resolved?.total;
  const tab = (key: string, label: string, count?: number) => ({ key, label, count });
  const options = [tab("active", t("rdb.cs_active"), st?.active), tab("open", t("status.open"), st?.open), tab("in_review", t("status.in_review"), st?.inReview), tab("resolved", t("status.resolved"), resolvedTotal),
    tab("all", t("common.all"), st && resolvedTotal !== undefined ? st.active + resolvedTotal : undefined)];
  const none = !queue.isLoading && !!qd && !filtered && (st?.active ?? 0) + (resolvedTotal ?? 0) === 0;

  return (
    <>
      <PageHeader title={t("nav.cases")} subtitle={t("cases.sub")} icon={<LifeBuoy className="size-5" />} />
      <StatGrid cols={5} className="mb-6">
        <Stat label={t("status.open")} value={st ? st.open : 0} loading={!st} icon={<Inbox className="size-5" aria-hidden />} href="/admin/cases?status=open" hint={t("rdb.k_open_hint")} />
        <Stat label={t("status.in_review")} value={st ? st.inReview : 0} loading={!st} tone="cyan" icon={<Clock className="size-5" aria-hidden />} href="/admin/cases?status=in_review" hint={t("rdb.k_review_hint")} />
        <Stat label={t("adm.unassigned")} value={st ? more(st.unassigned) : 0} loading={!st} tone={st?.unassigned ? "gold" : "muted"} icon={<UserX className="size-5" aria-hidden />} href="/admin/cases?status=open&assignee=unassigned" hint={t("rdb.k_unassigned_hint")} />
        <Stat label={t("rdb.k_urgent")} value={st ? more(st.urgent) : 0} loading={!st} tone={st?.urgent ? "danger" : "muted"} icon={<Flame className="size-5" aria-hidden />} href="/admin/cases?priority=urgent" hint={t("rdb.k_urgent_hint")} />
        <Stat label={t("rdb.k_resolved_week")} value={st ? st.resolvedWeek : 0} loading={!st} tone="muted" icon={<CheckCircle2 className="size-5" aria-hidden />} href="/admin/cases?status=resolved" hint={t("rdb.k_resolved_week_hint")} />
      </StatGrid>

      <Toolbar>
        <Segmented label={t("common.status")} value={status} onChange={f(setStatus)} options={options} />
      </Toolbar>
      <Toolbar>
        <div data-testid="foa-case-filter-q" className="contents"><SearchBox value={q} onChange={f(setQ)} placeholder={t("foa.case_search_ph")} label={t("common.search")} /></div>
        <div className="w-40"><Select data-testid="foa-case-filter-priority" aria-label={t("foa.case_priority")} placeholder={t("rdb.priority_all")} value={priority} onChange={(e) => f(setPriority)(e.target.value)} options={[{ value: "urgent", label: t("support.urgent") }, { value: "normal", label: t("foa.case_priority_normal") }]} /></div>
        <div className="w-44"><Select data-testid="foa-case-filter-role" aria-label={t("foa.case_opener")} placeholder={t("rdb.opener_any")} value={role} onChange={(e) => f(setRole)(e.target.value)} options={OPENER_ROLES.map((k) => ({ value: k, label: t(`role.${k}`) }))} /></div>
        <div className="w-48"><Select data-testid="foa-case-filter-assignee" aria-label={t("foa.case_assignee")} placeholder={t("rdb.assignee_any")} value={assignee} onChange={(e) => f(setAssignee)(e.target.value)}
          options={[{ value: "me", label: t("rdb.assignee_me") }, { value: "unassigned", label: t("adm.unassigned") }, ...people.people.filter((p) => p.id !== me.id).map((p) => ({ value: p.id, label: p.name }))]} /></div>
      </Toolbar>

      {list.error && !list.rows.length ? <ErrorState error={list.error} retry={list.reload} /> : list.loading ? <PageLoading /> : list.rows.length === 0 ? (
        none ? <EmptyState icon={<LifeBuoy className="size-9" aria-hidden />} title={t("rdb.cases_none")} hint={t("rdb.cases_none_hint")} />
          : <EmptyState icon={<LifeBuoy className="size-9" aria-hidden />} title={t("common.no_results")} hint={filtered ? t("rdb.cases_filtered_hint") : undefined} action={filtered ? <Button variant="secondary" size="sm" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack label={t("nav.cases")} head={[t("rdb.case_col"), t("foa.case_opener"), t("foa.case_assignee"), t("common.status"), t("rdb.updated"), { label: t("rdb.open_case"), srOnly: true }]}>
          {list.rows.map((x) => (
            <tr key={x.id} data-testid={`foa-case-row-${x.id}`} onClick={() => router.push(`/admin/cases/${x.id}`)} className={isUrgent(x) ? "cursor-pointer bg-danger/[0.04]" : "cursor-pointer"}>
              <Td label={t("rdb.case_col")}><CellPair title={x.subject} href={`/admin/cases/${x.id}`} sub={<><span className="ltr-num">{x.ref}</span> · {t(`ticket_cat.${x.category}`)}</>} className="max-w-72" /></Td>
              <Td label={t("foa.case_opener")}><CellPair title={x.openedByName ?? "—"} sub={<RoleBadge role={x.openedByRole} />} /></Td>
              <Td label={t("foa.case_assignee")} className="text-sm"><HandlerCell id={x.assignedTo} name={people.nameOf(x.assignedTo)} /></Td>
              <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={x.status} />{isUrgent(x) && <UrgentBadge />}</span></Td>
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
