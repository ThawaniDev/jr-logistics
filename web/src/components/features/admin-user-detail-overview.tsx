"use client";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Badge, EmptyState, InfoGrid, Notice, Section, StatusBadge, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { ActivityLog } from "./activity-log";
import { KpiTile } from "./admin-company-detail-kpis";
import { groupPermissions } from "./admin-system-lib";
import { useRoleNames } from "./admin-roles-data";
import { useUserDetail, type UserDetail } from "./admin-user-detail-shell";
import { auditTargetHref, userTabHref, userTabs } from "./admin-user-detail-lib";

const LANG: Record<string, string> = { ar: "العربية", en: "English", ur: "اردو" };

function EntityCard({ u }: { u: UserDetail }) {
  const { t, locale } = useI18n(); const tx = useTx(); const e = u.entity;
  if (!e) return null;
  const f = e.facts as Record<string, string | number | null | undefined>;
  const rows: Array<{ label: string; value: React.ReactNode }> = e.type === "business"
    ? [{ label: t("reg.cr"), value: f.crNumber ?? "—" }, { label: t("reg.tax"), value: f.taxNumber ?? "—" }, { label: t("reg.industry"), value: f.industry ?? "—" }, { label: t("dv3.u_rating"), value: f.rating ? `${f.rating} (${f.ratingCount})` : "—" }]
    : e.type === "office" ? [{ label: t("reg.cr"), value: f.crNumber ?? "—" }, { label: t("reg.city"), value: f.city ? tx(`city.${f.city}`, f.city) : "—" }, { label: t("dv3.u_drivers"), value: fmtNum(Number(f.drivers ?? 0), locale) }]
    : [{ label: t("reg.vehicle"), value: f.vehicleType ? t(`vehicle.${f.vehicleType}`) : "—" }, { label: t("reg.plate"), value: f.vehiclePlate ?? (u.sensitiveHidden ? "•••" : "—") }, { label: t("dv3.u_availability"), value: f.availability ? t(`dv3.u_avail_${f.availability}`) : "—" }, { label: t("dv3.u_jobs"), value: fmtNum(Number(f.jobsCompleted ?? 0), locale) }, { label: t("dv3.u_rating"), value: f.rating ? `${f.rating} (${f.ratingCount})` : "—" }];
  return (
    <Section title={t(`dv3.u_entity_${e.type}`)} actions={<Link href={e.href} className="text-sm text-accent hover:underline" data-testid="dv3-user-entity-card-link">{t(`dv3.u_open_${e.type}`)}</Link>}>
      <div className="space-y-4" data-testid="dv3-user-entity">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{e.name}</span><StatusBadge status={e.verificationStatus} /></div>
        <InfoGrid cols={3} items={rows.map((r) => ({ label: r.label, value: <span className="ltr-num">{r.value}</span> }))} />
      </div>
    </Section>
  );
}

function StaffCard({ u }: { u: UserDetail }) {
  const { t, locale } = useI18n(); const me = useUser(); const s = u.staff; const roles = useRoleNames(!!s?.staffRole);
  if (!s) return null;
  const groups = groupPermissions(s.permissions);
  return (
    <Section title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-muted" aria-hidden />{t("dv3.u_staff_title")}</span>} description={t("dv3.u_staff_sub")}>
      <div className="space-y-5" data-testid="dv3-user-staff">
        <InfoGrid cols={3} items={[
          { label: t("dv3.u_staff_role"), value: s.staffRole ? (hasPerm(me, "staff.view") || hasPerm(me, "staff.manage") ? <Link data-testid="rj-user-role-link" href={`/admin/roles?role=${encodeURIComponent(s.staffRole)}`} className="text-accent hover:underline">{roles.label(s.staffRole)}</Link> : roles.label(s.staffRole)) : u.role === "admin" ? t("role.admin") : t("staff.custom") },
          { label: t("dv3.u_mfa"), value: s.mfaEnabled ? <Badge tone="success"><span data-testid="dv3-user-mfa">{t("dv3.u_mfa_on")}</span></Badge> : <Badge tone="warn"><span data-testid="dv3-user-mfa">{t("dv3.u_mfa_off")}</span></Badge> },
          { label: t("dv3.u_lock"), value: s.locked ? <Badge tone="danger"><span data-testid="dv3-user-lock">{t("dv3.u_locked_until", { when: fmtDateTime(s.lockedUntil, locale) })}</span></Badge> : <Badge tone="success"><span data-testid="dv3-user-lock">{t("dv3.u_unlocked")}</span></Badge> },
          { label: t("dv3.u_failed_logins"), value: <span className="ltr-num">{fmtNum(s.failedLogins, locale)}</span> },
          { label: t("dv3.u_must_change"), value: u.mustChangePassword ? t("dv3.yes") : t("dv3.no") },
          ...(s.mfaEnabledAt ? [{ label: t("dv3.u_mfa_since"), value: fmtDateTime(s.mfaEnabledAt, locale) }] : []),
        ]} />
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><KeyRound className="size-3.5" aria-hidden />{t("staff.perms")} <span className="ltr-num tabular-nums">({s.allPermissions ? t("dv3.u_all_perms") : s.permissions.length})</span></p>
          {s.allPermissions ? <p className="text-sm text-muted">{t("dv3.u_admin_all")}</p> : groups.length === 0 ? <p className="text-sm text-muted">{t("dv3.u_no_perms")}</p> : (
            <div className="space-y-3" data-testid="dv3-user-perms">
              {groups.map((g) => (
                <div key={g.area} role="group" aria-label={t(`rdb.perm_area_${g.area}`)}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`rdb.perm_area_${g.area}`)}</p>
                  <div className="flex flex-wrap gap-1.5">{g.perms.map((p) => <Badge key={p}><span dir="ltr" className="ltr-num">{p}</span></Badge>)}</div>
                </div>))}
            </div>)}
        </div>
      </div>
    </Section>
  );
}

function ActionsBy({ u }: { u: UserDetail }) {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser(); const a = u.actions;
  if (u.auditHidden) return <Notice tone="info">{t("dv3.u_audit_hidden")}</Notice>;
  if (!a) return null;
  return (
    <Section title={t("dv3.u_actions_title")} description={t("dv3.u_actions_sub", { n: fmtNum(a.total, locale) })} flush>
      {a.total === 0 ? <div className="p-5"><EmptyState title={t("dv3.u_actions_none")} /></div> : (
        <div data-testid="dv3-user-actions">
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">{a.byAction.map((x) => <Badge key={x.action}>{tx(`dtk.act.${x.action}`, x.action)} <span className="ltr-num font-semibold">{fmtNum(x.n, locale)}</span></Badge>)}</div>
          <Table bare stack dense label={t("dv3.u_actions_title")} head={[t("common.date"), t("dv3.u_action"), t("dv3.u_target")]}>
            {a.latest.map((x) => { const href = auditTargetHref(x.entity, x.entityId); return (
              <tr key={x.id}>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(x.at, locale)}</Td>
                <Td label={t("dv3.u_action")}>{tx(`dtk.act.${x.action}`, x.action)}</Td>
                <Td label={t("dv3.u_target")} className="text-muted">{href && hasPerm(me, "audit.view") ? <Link href={href} className="text-accent hover:underline">{t(`dv3.u_t_${x.entity}`)}</Link> : tx(`dv3.u_t_${x.entity}`, x.entity)}</Td>
              </tr>); })}
          </Table>
        </div>)}
    </Section>
  );
}

/** Overview section: state, last sign-in and support load at a glance, identity facts with where the account came from, the role-specific summary, staff permissions and what they did, recent activity. */
export function UserOverview() {
  const { t, locale } = useI18n(); const me = useUser(); const u = useUserDetail(); const tx = useTx();
  const l = u.login;
  return (
    <div className="space-y-5" data-testid="dv3-user-overview">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <KpiTile id="u-status" label={t("common.status")} def={t("dv3.ud_status")} value={t(`status.${u.status}`)} tone={u.status === "suspended" ? "danger" : undefined} hint={t(`role.${u.role}`)} />
        <KpiTile id="u-login" label={t("dv3.f_last_login")} def={t("dv3.ud_login")} value={l.lastLoginAt ? fmtDateTime(l.lastLoginAt, locale) : t("dv3.never")} hint={l.lastLoginClient ? t(`dv3.client_${l.lastLoginClient}`) : undefined} href={hasPerm(me, "users.view") || u.staff ? userTabHref(u.id, "security") : undefined} />
        <KpiTile id="u-logins" label={t("dv3.f_logins")} def={t("dv3.ud_logins")} value={fmtNum(l.loginCount, locale)} hint={l.lastSeenAt ? t("dv3.u_seen", { when: fmtDateTime(l.lastSeenAt, locale) }) : undefined} />
        {u.counts.tickets && <KpiTile id="u-tickets" label={t("dv3.u_tickets")} def={t("dv3.ud_tickets")} value={fmtNum(u.counts.tickets.open, locale)} tone={u.counts.tickets.open > 0 ? "gold" : undefined} hint={t("dv3.u_of_total", { n: fmtNum(u.counts.tickets.total, locale) })} />}
        {u.counts.complaints && <KpiTile id="u-complaints" label={t("dv3.u_complaints")} def={t("dv3.ud_complaints")} value={fmtNum(u.counts.complaints.open, locale)} tone={u.counts.complaints.open > 0 ? "gold" : undefined} hint={t("dv3.u_of_total", { n: fmtNum(u.counts.complaints.total, locale) })} />}
        <KpiTile id="u-notes" label={t("dv3.ut_notes")} def={t("dv3.ud_notes")} value={fmtNum(u.counts.notes, locale)} href={userTabHref(u.id, "notes")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={t("dv3.u_account")} description={t("dv3.u_account_sub")}>
            <InfoGrid cols={3} items={[
              { label: t("common.role"), value: t(`role.${u.role}`) },
              { label: t("common.status"), value: <StatusBadge status={u.status} /> },
              { label: t("auth.phone"), value: u.phone ? <span className="ltr-num" dir="ltr">{u.phone}</span> : "—" },
              { label: t("auth.email"), value: u.email ? <span className="ltr-num break-all" dir="ltr">{u.email}</span> : "—" },
              { label: t("reg.city"), value: u.city ? tx(`city.${u.city}`, u.city) : "—" },
              { label: t("acr.language"), value: LANG[u.language] ?? u.language },
              { label: t("dv3.f_source"), value: <span data-testid="dv3-user-source">{t(`dv3.src_${u.source}`)}</span> },
              { label: t("dv3.f_created_by"), value: u.createdBy ? (hasPerm(me, "staff.view") || hasPerm(me, "staff.manage") ? <Link href={`/admin/users/${u.createdBy.id}`} className="text-accent hover:underline" data-testid="dv3-user-created-by">{u.createdBy.name}</Link> : u.createdBy.name) : "—" },
              { label: t("rdp.fact_joined"), value: fmtDateTime(u.createdAt, locale) },
              { label: t("dv3.u_updated"), value: fmtDateTime(u.updatedAt, locale) },
              { label: t("dv3.sec_address"), value: l.lastLoginIp ? <span className="ltr-num" dir="ltr">{l.lastLoginIp}</span> : "—" },
              { label: t("dv3.f_last_seen"), value: l.lastSeenAt ? fmtDateTime(l.lastSeenAt, locale) : "—" },
            ]} />
          </Section>
          <EntityCard u={u} />
          <StaffCard u={u} />
          <ActionsBy u={u} />
        </div>
        {userTabs(u.role, (p) => hasPerm(me, p)).includes("activity") && (
          <div>
            <ActivityLog entity="user" id={u.id} compact title={t("dv3.u_recent")} />
            <p className="mt-2 text-end text-sm"><Link href={userTabHref(u.id, "activity")} className="text-accent hover:underline">{t("common.view_all")}</Link></p>
          </div>)}
      </div>
    </div>
  );
}
