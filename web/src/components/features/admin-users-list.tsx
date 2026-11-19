"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, Factory, ShieldCheck, Truck, Users, Warehouse } from "lucide-react";
import { Badge, Button, CellPair, ErrorState, PageHeader, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useDebounced } from "./admin-common";
import { AccountStatusButton } from "./admin-drivers-actions";
import { ListEmpty, LoadingRows, RowLink, pagerFooter } from "./admin-offices-common";
import { USER_ROLES, apiFilter, parseUserRole } from "./admin-offices-lib";
import { WarehouseOpsDialog } from "./admin-warehouse";

const SIZE = 25;
/** Where an account's own view lives (and who may open it): the entity views replaced the old "review" modal. */
function entityHref(u: { id: string; role: string }, me: Parameters<typeof hasAny>[0]) {
  if (u.role === "business" && hasAny(me, "users.view", "verification.manage", "offices.view")) return `/admin/companies/${u.id}`;
  if (u.role === "office" && hasAny(me, "users.view", "offices.view", "offices.manage")) return `/admin/offices/${u.id}`;
  if (u.role === "driver" && hasAny(me, "drivers.view", "users.view")) return `/admin/drivers/${u.id}`;
  return null;
}

/** `/admin/users`: accounts per role (KPIs that filter the list), role + status filters in the URL, and the accounts table. */
export function UsersList() {
  const { t, locale } = useI18n(); const me = useUser(); const sp = useSearchParams();
  const [roleRaw, setRole] = useUrlState("role", "all"); const [statusRaw, setStatus] = useUrlState("status");
  const role = parseUserRole(roleRaw); const status = statusRaw === "active" || statusRaw === "suspended" ? statusRaw : "";
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const [wh, setWh] = useState<null | { id: string; name: string }>(null);
  const sum = useApi("/admin/accounts-summary", { keepPreviousData: true });
  const list = useApi(`/admin/users${qs({ page, pageSize: SIZE, role: apiFilter(role), status, q: dq })}`, { keepPreviousData: true });
  const s = sum.data; const rows: any[] = list.data?.items ?? []; const loading = !list.data && !list.error; const sl = !s && !sum.error;
  const filtered = role !== "all" || !!status || !!dq;
  const reset = () => { setQ(""); setRole("all"); setStatus(""); setPage(1); };
  const roleLabel = (r: string) => (r === "all" ? t("common.all") : t(`rdq.roles_${r}`));
  const info = (r: string) => { const x = s?.roles?.[r]; if (!x) return undefined; const parts = [x.review ? t("rdq.n_review", { n: x.review }) : null, x.suspended ? t("rdq.n_suspended", { n: x.suspended }) : null].filter(Boolean); return parts.length ? parts.join(" · ") : t("rdq.all_good"); };
  const val = (r: string) => (sum.error ? "—" : s?.roles?.[r]?.total ?? 0);
  const head = [t("common.name"), t("common.role"), t("verify.title"), t("common.status"), t("rdq.col_joined"), { label: t("rdq.col_actions"), srOnly: true }];
  const canEdit = hasPerm(me, "users.edit");
  return (
    <>
      <PageHeader title={t("nav.users")} subtitle={t("rdq.users_sub")} icon={<Users className="size-5" />} />
      <section aria-label={t("rdq.kpis")} className="mb-5">
        <StatGrid cols={4}>
          <Stat label={t("rdq.roles_business")} value={val("business")} loading={sl} icon={<Factory className="size-5" />} href="/admin/users?role=business" tone="accent" hint={info("business")} />
          <Stat label={t("rdq.roles_driver")} value={val("driver")} loading={sl} icon={<Truck className="size-5" />} href="/admin/users?role=driver" tone="cyan" hint={info("driver")} />
          <Stat label={t("rdq.roles_office")} value={val("office")} loading={sl} icon={<Building2 className="size-5" />} href="/admin/users?role=office" tone="gold" hint={info("office")} />
          <Stat label={t("rdq.roles_staff")} value={val("staff")} loading={sl} icon={<ShieldCheck className="size-5" />} href="/admin/users?role=staff" tone="muted" hint={s?.roles?.staff?.suspended ? info("staff") : t("rdq.staff_hint")} />
        </StatGrid>
      </section>
      {list.error && !list.data ? <ErrorState error={list.error} retry={() => list.mutate()} /> : (
        <Table stack label={t("nav.users")} head={head}
          toolbar={<>
            <SearchBox className="sm:w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("admin.search_users")} label={t("admin.search_users")} />
            <Segmented label={t("common.role")} value={role} onChange={(k) => { setRole(k); setPage(1); }} options={USER_ROLES.map((r) => ({ key: r, label: roleLabel(r), count: r === "all" ? s?.total : s?.roles?.[r]?.total }))} />
            <div className="w-44"><Select aria-label={t("common.status")} placeholder={t("rdq.status_any")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "active", label: t("status.active") }, { value: "suspended", label: `${t("status.suspended")}${s?.suspended ? ` (${s.suspended})` : ""}` }]} /></div>
          </>}
          empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={reset} title={t("rdq.users_none")} hint={t("rdq.users_none_hint")} /> : undefined}
          footer={list.data ? pagerFooter(page, list.data.total, SIZE, setPage) : undefined}>
          {loading ? <LoadingRows cols={head.length} /> : rows.map((u) => {
            const href = entityHref(u, me);
            return (
              <tr key={u.id} data-testid={`rdq-user-row-${u.id}`}>
                <Td>
                  <CellPair title={u.name} href={href ?? undefined} sub={<span className="ltr-num">{u.phone ?? u.email ?? "—"}</span>} />
                  {u.role === "business" && typeof u.warehouseSet === "boolean" && (
                    <Link href={`/admin/companies/${u.id}`} className="mt-1 inline-block" aria-label={t("foa.wh_title")}><Badge tone={u.warehouseSet ? "success" : "warn"}><span data-testid={`foa-wh-badge-${u.id}`}>{u.warehouseSet ? t("foa.wh_loc_set") : t("foa.wh_loc_missing")}</span></Badge></Link>
                  )}
                </Td>
                <Td label={t("common.role")}>{t(`role.${u.role}`)}</Td>
                <Td label={t("verify.title")}>{u.verificationStatus ? <StatusBadge status={u.verificationStatus} /> : "—"}</Td>
                <Td label={t("common.status")}><StatusBadge status={u.status} /></Td>
                <Td label={t("rdq.col_joined")} className="whitespace-nowrap text-muted">{fmtDate(u.createdAt, locale)}</Td>
                <Td align="end">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {u.role === "business" && <Button size="sm" variant="secondary" data-testid={`foa-wh-open-${u.id}`} onClick={() => setWh({ id: u.id, name: u.name })}><Warehouse className="size-4" aria-hidden />{t("foa.wh_title")}</Button>}
                    {canEdit && !["admin", "staff"].includes(u.role) && <AccountStatusButton user={u} onDone={() => { list.mutate(); sum.mutate(); }} />}
                    {href && <RowLink href={href} label={t("rdq.open_named", { name: u.name })} testid={`rdq-user-open-${u.id}`} />}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      <WarehouseOpsDialog business={wh} onClose={() => setWh(null)} />
    </>
  );
}
