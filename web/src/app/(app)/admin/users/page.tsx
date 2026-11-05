"use client";
import { useState } from "react";
import { Ban, CheckCircle } from "lucide-react";
import { Button, EmptyState, ErrorState, Input, PageHeader, PageLoading, Pagination, Select, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

function UsersTable({ role }: { role?: string }) {
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const [q, setQ] = useState(""); const [r, setR] = useState(role ?? ""); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/admin/users?page=${page}&pageSize=25${r ? `&role=${r}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3"><div className="w-64"><Input aria-label={t("common.search")} placeholder={t("admin.search_users")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {!role && <div className="w-44"><Select aria-label={t("common.role")} placeholder={t("common.all")} options={["business", "driver", "office", "staff", "admin"].map((x) => ({ value: x, label: t(`role.${x}`) }))} value={r} onChange={(e) => { setR(e.target.value); setPage(1); }} /></div>}</div>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("common.no_results")} /> : <>
        <Table head={[t("common.name"), t("common.role"), t("auth.phone"), t("common.date"), t("common.status"), ""]}>
          {data.items.map((u: any) => <tr key={u.id}><Td className="font-medium">{u.name}</Td><Td>{t(`role.${u.role}`)}</Td><Td className="ltr-num text-muted">{u.phone ?? u.email ?? "—"}</Td><Td className="text-muted">{fmtDateTime(u.createdAt, locale)}</Td><Td><StatusBadge status={u.status} /></Td>
            <Td>{hasPerm(me, "users.edit") && !["admin", "staff"].includes(u.role) && (u.status === "active"
              ? <Button size="sm" variant="danger" loading={a.is(u.id)} onClick={() => confirm(t("admin.suspend_confirm")) && a.run(u.id, () => post(`/admin/users/${u.id}/status`, { status: "suspended" }), { success: "common.saved", onDone: () => mutate() })}><Ban className="size-4" />{t("admin.suspend")}</Button>
              : <Button size="sm" variant="secondary" loading={a.is(u.id)} onClick={() => a.run(u.id, () => post(`/admin/users/${u.id}/status`, { status: "active" }), { success: "common.saved", onDone: () => mutate() })}><CheckCircle className="size-4" />{t("admin.activate")}</Button>)}</Td></tr>)}
        </Table><Pagination page={page} total={data.total} pageSize={25} onPage={setPage} /></>}
    </>
  );
}
export default function AdminUsers() { const { t } = useI18n(); return <><PageHeader title={t("nav.users")} /><UsersTable /></>; }
