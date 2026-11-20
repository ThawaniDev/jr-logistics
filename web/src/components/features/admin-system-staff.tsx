"use client";
import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { KeyRound, Lock, LockOpen, ShieldCheck, ShieldOff, UserPlus, UserRoundCog, Users } from "lucide-react";
import { Avatar, Badge, Button, CellPair, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td, Toolbar, useAction } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ConfirmModal, fullErr } from "./admin-common";
import { StaffFormModal, type StaffEdit } from "./admin-system-staff-form";
import { useCatalog, useRoleList } from "./admin-roles-data";
import { roleLabel, type RoleItem } from "./admin-roles-lib";
import { filterStaff, isLocked, staffStats, type StaffRow } from "./admin-system-lib";

/** An icon button of a table row; on phones (stacked cards) its label is visible, on wider screens it is a tooltip + screen-reader text. */
function RowAction({ label, icon, onClick, loading, danger, testid }: { label: string; icon: ReactNode; onClick: () => void; loading?: boolean; danger?: boolean; testid?: string }) {
  return <Button data-testid={testid} size="sm" variant={danger ? "danger" : "ghost"} title={label} loading={loading} onClick={onClick}>{icon}<span className="sm:sr-only">{label}</span></Button>;
}

/** The role of a staff member as a badge that opens the role on Roles & permissions (system roles by their translated name, custom roles by their own). */
function RoleChip({ roleKey, roles }: { roleKey: string; roles: RoleItem[] }) {
  const { t } = useI18n(); const me = useUser();
  const r = roles.find((x) => x.key === roleKey);
  const label = r ? roleLabel(t, r) : t(`preset.${roleKey}`) === `preset.${roleKey}` ? roleKey : t(`preset.${roleKey}`);
  const badge = <Badge tone="info">{label}</Badge>;
  return r && (hasPerm(me, "staff.view") || hasPerm(me, "staff.manage")) ? <Link data-testid={`rj-staff-role-${roleKey}`} href={`/admin/roles?role=${encodeURIComponent(roleKey)}`} className="hover:opacity-80">{badge}</Link> : badge;
}

/** Staff accounts (`/admin/staff`): KPI row, filters, table with security state, role / permission editing, password and two-step resets, unlock, suspend. */
export function StaffConsole() { return <Suspense fallback={<PageLoading />}><StaffInner /></Suspense>; }

function StaffInner() {
  const { t } = useI18n(); const a = useAction(); const me = useUser();
  const { data, error, mutate } = useApi<{ items: StaffRow[] }>("/admin/staff"); const rl = useRoleList(); const cat = useCatalog(); const metaError = rl.error ?? cat.error;
  const meta = rl.data && cat.data ? { roles: rl.data.items, groups: cat.data.groups } : null; // roles (system + custom) and the permission catalogue feed the role select and the custom picker
  const [filter, setFilter] = useUrlState("filter", "all"); const [role, setRole] = useUrlState("role", ""); const [q, setQ] = useState("");
  const sp = useSearchParams(); const [m, setM] = useState<StaffEdit | null>(() => (sp.get("add") === "1" && hasPerm(me, "staff.manage") ? {} : null)); // `/admin/staff?add=1` (the "Staff member" card of Add user) opens the form
  const [conf, setConf] = useState<null | { kind: "mfa" | "status"; s: StaffRow }>(null); const [pw, setPw] = useState<null | { id: string; name: string }>(null); const [pwv, setPwv] = useState(""); const [pwErr, setPwErr] = useState<string | null>(null);
  if (error || metaError) return <ErrorState error={error ?? metaError} retry={() => { mutate(); rl.mutate(); cat.mutate(); }} />;
  if (!data || !meta) return <PageLoading />;
  const canManage = hasPerm(me, "staff.manage");
  const rows = data.items; const st = staffStats(rows); const shown = filterStaff(rows, filter, q).filter((s) => !role || (role === "custom" ? !s.staffRole : s.staffRole === role));
  const reset = () => a.run("pw", () => post(`/admin/staff/${pw!.id}/reset-password`, { password: pwv }), { success: "common.saved", onDone: () => { setPw(null); setPwv(""); }, onError: (e) => setPwErr(fullErr(e, t)) });
  const edit = (s: StaffRow) => setM({ id: s.id, had: s.permissions, name: s.name, staffRole: s.staffRole, permissions: s.permissions });
  const options = [{ key: "all", label: t("common.all"), count: st.total }, { key: "active", label: t("status.active"), count: st.active }, { key: "suspended", label: t("status.suspended"), count: st.suspended },
    { key: "locked", label: t("rdb.staff_locked"), count: st.locked }, { key: "no_mfa", label: t("rdb.staff_no_mfa"), count: st.noMfa }];

  return (
    <>
      <PageHeader title={t("nav.staff")} subtitle={t("staff.sub")} icon={<UserRoundCog className="size-5" />}
        actions={canManage && <Button data-testid="rdb-staff-add" onClick={() => setM({})}><UserPlus className="size-4" aria-hidden />{t("staff.add")}</Button>} />
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("nav.staff")} value={st.total} icon={<Users className="size-5" aria-hidden />} href="/admin/staff" hint={t("rdb.staff_k_total_hint", { a: st.active, s: st.suspended })} />
        <Stat label={t("rdb.staff_locked")} value={st.locked} tone={st.locked ? "danger" : "muted"} icon={<Lock className="size-5" aria-hidden />} href="/admin/staff?filter=locked" hint={t("rdb.staff_k_locked_hint")} />
        <Stat label={t("rdb.staff_k_mfa")} value={st.mfa} tone="cyan" icon={<ShieldCheck className="size-5" aria-hidden />} href="/admin/staff?filter=no_mfa" hint={t("rdb.staff_k_mfa_hint", { n: st.noMfa })} />
        <Stat label={t("rdb.staff_k_temp")} value={rows.filter((s) => s.mustChangePassword).length} tone={rows.some((s) => s.mustChangePassword) ? "gold" : "muted"} icon={<KeyRound className="size-5" aria-hidden />} hint={t("rdb.staff_k_temp_hint")} />
      </StatGrid>

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder={t("rdb.staff_search_ph")} label={t("common.search")} />
        <Segmented label={t("common.status")} value={filter} onChange={setFilter} options={options} />
        <div className="w-full sm:w-56"><Select data-testid="rj-staff-role-filter" aria-label={t("rj.role")} placeholder={t("rj.filter_all_roles")} value={role} onChange={(e) => setRole(e.target.value)}
          options={[...meta.roles.map((r) => ({ value: r.key, label: roleLabel(t, r) })), { value: "custom", label: t("rj.filter_custom") }]} /></div>
      </Toolbar>

      {rows.length === 0 ? <EmptyState icon={<UserRoundCog className="size-9" aria-hidden />} title={t("staff.none")} hint={t("rdb.staff_none_hint")} action={canManage ? <Button size="sm" onClick={() => setM({})}><UserPlus className="size-4" aria-hidden />{t("staff.add")}</Button> : undefined} />
        : shown.length === 0 ? <EmptyState title={t("common.no_results")} action={<Button variant="secondary" size="sm" onClick={() => { setQ(""); setFilter("all"); setRole(""); }}>{t("uxa.clear_filters")}</Button>} /> : (
        <Table stack label={t("nav.staff")} head={[t("common.name"), t("rj.role"), { label: t("staff.perms"), align: "end" }, t("rdb.staff_2step"), t("common.status"), { label: t("rdb.staff_actions"), srOnly: true }]}>
          {shown.map((s) => { const self = s.id === me.id; const locked = isLocked(s); return (
            <tr key={s.id} data-testid={`rdb-staff-row-${s.id}`}>
              <Td label={t("common.name")}><div className="flex min-w-0 items-center gap-3"><Avatar name={s.name} size={36} /><CellPair title={<span className="inline-flex items-center gap-2">{s.name}{self && <Badge>{t("adm.you")}</Badge>}</span>} sub={<span className="ltr-num">{s.email}</span>} /></div></Td>
              <Td label={t("rj.role")}>{s.staffRole ? <RoleChip roleKey={s.staffRole} roles={meta.roles} /> : <span className="text-muted">{t("staff.custom")}</span>}</Td>
              <Td label={t("staff.perms")} num>{s.permissions.length}</Td>
              <Td label={t("rdb.staff_2step")}>{s.totpEnabledAt ? <Badge tone="success"><ShieldCheck className="size-3" aria-hidden />{t("rdb.staff_mfa_on")}</Badge> : <Badge tone="neutral"><ShieldOff className="size-3" aria-hidden />{t("rdb.staff_mfa_off")}</Badge>}</Td>
              <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={s.status} />{locked && <Badge tone="danger"><Lock className="size-3" aria-hidden />{t("rdb.staff_locked")}</Badge>}{s.mustChangePassword && <Badge tone="warn">{t("rdb.staff_temp_badge")}</Badge>}</span></Td>
              <Td align="end">{canManage && <div className="flex flex-wrap justify-end gap-1">
                <Button data-testid={`rdb-staff-edit-${s.id}`} size="sm" variant="secondary" onClick={() => edit(s)}>{t("common.edit")}</Button>
                {!self && <>
                  <RowAction label={t("adm.reset_password")} icon={<KeyRound className="size-4" aria-hidden />} onClick={() => { setPw({ id: s.id, name: s.name }); setPwv(""); setPwErr(null); }} />
                  <RowAction label={t("mfa.reset")} icon={<ShieldOff className="size-4" aria-hidden />} loading={a.is("mfa" + s.id)} onClick={() => setConf({ kind: "mfa", s })} />
                  <RowAction label={t("adm.unlock")} icon={<LockOpen className="size-4" aria-hidden />} loading={a.is("ul" + s.id)} onClick={() => a.run("ul" + s.id, () => post(`/admin/staff/${s.id}/unlock`), { success: "adm.unlocked", onDone: () => mutate() })} />
                  <Button data-testid={`rdb-staff-status-${s.id}`} size="sm" variant={s.status === "active" ? "danger" : "secondary"} loading={a.is(s.id)} onClick={() => (s.status === "active" ? setConf({ kind: "status", s }) : a.run(s.id, () => patch(`/admin/staff/${s.id}`, { status: "active" }), { success: "common.saved", onDone: () => mutate() }))}>{s.status === "active" ? t("admin.suspend") : t("admin.activate")}</Button></>}
              </div>}</Td>
            </tr>); })}
        </Table>)}

      {m && <StaffFormModal key={m.id ?? "new"} edit={m} meta={meta} onClose={() => setM(null)} onSaved={() => mutate()} />}
      <ConfirmModal open={!!conf} onClose={() => setConf(null)} danger busy={a.any}
        title={conf ? `${conf.kind === "mfa" ? t("mfa.reset") : t("admin.suspend")} · ${conf.s.name}` : ""} confirmLabel={conf?.kind === "mfa" ? t("mfa.reset") : t("admin.suspend")}
        onConfirm={() => conf && (conf.kind === "mfa"
          ? a.run("mfa" + conf.s.id, () => post(`/admin/staff/${conf.s.id}/reset-mfa`), { success: "common.saved", onDone: () => { setConf(null); mutate(); } })
          : a.run(conf.s.id, () => patch(`/admin/staff/${conf.s.id}`, { status: "suspended" }), { success: "common.saved", onDone: () => { setConf(null); mutate(); } }))}>
        <p className="text-sm">{conf?.kind === "mfa" ? t("mfa.reset_confirm") : t("uxa.staff_suspend_confirm", { name: conf?.s.name ?? "" })}</p>
      </ConfirmModal>
      <Modal open={!!pw} onClose={() => setPw(null)} title={pw ? `${t("adm.reset_password")} · ${pw.name}` : ""} footer={<><Button variant="ghost" onClick={() => setPw(null)}>{t("common.cancel")}</Button><Button loading={a.is("pw")} disabled={pwv.length < 10} onClick={reset}>{t("common.confirm")}</Button></>}>
        <Notice tone="info">{t("adm.reset_note")}</Notice>
        <Input label={t("staff.temp_password")} type="password" ltr autoComplete="new-password" value={pwv} onChange={(e) => setPwv(e.target.value)} hint={t("staff.password_hint")} />
        {pwErr && <p role="alert" className="text-sm text-danger">{pwErr}</p>}
      </Modal>
    </>
  );
}
