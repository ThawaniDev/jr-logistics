"use client";
/** Data hooks of the support pages: the live queue (KPIs + counts), the people who can take a case, and cache refresh after a change. */
import useSWR, { mutate } from "swr";
import { get } from "@/lib/api";
import { useApi } from "@/components/ui/data";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs } from "./admin-common";
import { filterByOpenerRole } from "./admin-fieldops-lib";
import { loadAllPages, matchAssignee, paginate, sortCases, statusesFor, type CaseRow, type Slice } from "./admin-system-lib";

export type CaseKind = "tickets" | "complaints";
const BASE: Record<CaseKind, string> = { tickets: "/admin/tickets", complaints: "/admin/complaints" };
export const casePath = (kind: CaseKind, q: Record<string, string | number | undefined>) => `${BASE[kind]}${qs(q)}`;
const PAGE = 100; // the API maximum

export interface CaseFilters { status?: string; priority?: string; role?: string; q?: string }
/** Reads a case list page by page (100 per request, newest / most urgent first) until everything is in hand or `cap` pages were read. */
export const loadCases = (kind: CaseKind, f: CaseFilters, cap = 5, size = PAGE): Promise<Slice<CaseRow>> =>
  loadAllPages((page) => get(casePath(kind, { ...f, page, pageSize: size })), cap);

/** [status, pages to read, page size] per kind: counts come from `total`, the rows of live statuses feed the "unassigned / urgent / on hold" KPIs. */
const QUEUE: Record<CaseKind, Array<[string, number, number]>> = {
  tickets: [["open", 5, PAGE], ["in_review", 5, PAGE], ["resolved", 2, PAGE]],
  complaints: [["open", 5, PAGE], ["in_progress", 5, PAGE], ["resolved", 2, PAGE], ["closed", 1, 1]],
};
/** Live queue of a case list, refreshed every 30 s: a slice (`total` + rows) per status. */
export function useQueue(kind: CaseKind, enabled = true) {
  return useSWR<Record<string, Slice<CaseRow>>>(enabled ? ["rdb-queue", kind] : null, async () => {
    const parts = await Promise.all(QUEUE[kind].map(async ([status, cap, size]) => [status, await loadCases(kind, { status }, cap, size)] as const));
    return Object.fromEntries(parts);
  }, { refreshInterval: 30_000, revalidateOnFocus: true, shouldRetryOnError: false, keepPreviousData: true });
}

/** Refreshes every cached case list, queue and open detail after a change (assign, status, note …). */
export const refreshCases = () => mutate((k) => (Array.isArray(k) && typeof k[0] === "string" && k[0].startsWith("rdb-")) || (typeof k === "string" && /^\/(admin\/)?(tickets|complaints)/.test(k)));

/**
 * Staff who can take a case. Tickets: `GET /admin/tickets/assignees` (anyone who sees the queue). Complaints: the staff list, which needs
 * staff.view / staff.manage — without it only "assign to me" is offered and handler names are not resolved.
 */
export function useAssignees(kind: CaseKind) {
  const me = useUser();
  const tickets = useApi<{ items: Array<{ id: string; name: string }> }>(kind === "tickets" ? "/admin/tickets/assignees" : null, { shouldRetryOnError: false });
  const staff = useApi<{ items: Array<{ id: string; name: string; status: string }> }>(kind === "complaints" && hasAny(me, "staff.view", "staff.manage") ? "/admin/staff" : null, { shouldRetryOnError: false });
  const people = kind === "tickets" ? tickets.data?.items ?? [] : (staff.data?.items ?? []).filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }));
  const nameOf = (id: string | null | undefined) => (id ? (id === me.id ? me.name : people.find((p) => p.id === id)?.name ?? (staff.data?.items ?? []).find((s) => s.id === id)?.name ?? null) : null);
  return { people, nameOf, error: tickets.error ?? staff.error, canList: kind === "tickets" || hasAny(me, "staff.view", "staff.manage") };
}

export interface CaseQuery { status: string; priority: string; role: string; assignee: string; hold: string; q: string; page: number }
/**
 * The rows of a case list for the current filters. Plain status / priority / role / search filters are sent to the API (paged there).
 * "Active" (two statuses), "assigned to …" and "holding payment" have no API filter, so those views read the whole matching list (up to 500)
 * and filter, sort and page it here. Either way the result is one page: `rows`, with `total` being the number of matching cases.
 */
export function useCaseList(kind: CaseKind, f: CaseQuery, size: number) {
  const me = useUser();
  const local = f.status === "active" || !!f.assignee || !!f.hold;
  const filters: CaseFilters = { status: f.status === "all" ? "" : f.status, priority: f.priority, role: f.role, q: f.q };
  const server = useApi<{ items: CaseRow[]; total: number }>(local ? null : casePath(kind, { ...filters, page: f.page, pageSize: size }), { keepPreviousData: true, shouldRetryOnError: false });
  const all = useSWR<Slice<CaseRow>>(local ? ["rdb-cases", kind, JSON.stringify(filters)] : null, async () => {
    const parts = await Promise.all(statusesFor(kind, f.status).map((status) => loadCases(kind, { ...filters, status })));
    return { items: parts.flatMap((p) => p.items), total: parts.reduce((n, p) => n + p.total, 0), capped: parts.some((p) => p.capped) };
  }, { keepPreviousData: true, refreshInterval: 30_000, shouldRetryOnError: false });
  if (!local) return { rows: filterByOpenerRole(server.data?.items ?? [], f.role), total: server.data?.total ?? 0, loading: !server.data, error: server.error, reload: () => server.mutate(), capped: false };
  const list = sortCases((all.data?.items ?? []).filter((c) => matchAssignee(c, f.assignee, me.id) && (!f.hold || !!c.holdsSettlement)));
  return { rows: paginate(list, f.page, size), total: list.length, loading: !all.data, error: all.error, reload: () => all.mutate(), capped: !!all.data?.capped };
}
