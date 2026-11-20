"use client";
import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ShieldAlert, UserRound } from "lucide-react";
import { Avatar, Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, LinkTabs, PageHeader, PageLoading, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { AccountStatusButton } from "./admin-drivers-actions";
import { userTabHref, userTabs, type UserTab } from "./admin-user-detail-lib";
import { useRoleNames } from "./admin-roles-data";

export interface UserDetail {
  id: string; role: string; name: string; phone: string | null; email: string | null; city: string | null; language: string; status: string; isDemo: boolean; source: string;
  createdBy: { id: string; name: string; role: string } | null; createdAt: string; updatedAt: string; mustChangePassword: boolean;
  login: { lastLoginAt: string | null; lastSeenAt: string | null; loginCount: number; lastLoginIp: string | null; lastLoginClient: string | null };
  entity: { type: string; name: string; href: string; verificationStatus: string; facts: Record<string, unknown> } | null;
  staff: { staffRole: string | null; permissions: string[]; mfaEnabled: boolean; mfaEnabledAt: string | null; locked: boolean; lockedUntil: string | null; failedLogins: number; allPermissions: boolean } | null;
  counts: { tickets: { total: number; open: number } | null; complaints: { total: number; open: number } | null; notes: number };
  actions: { total: number; lastAt: string | null; byAction: Array<{ action: string; n: number }>; latest: Array<{ id: string; at: string; action: string; entity: string; entityId: string | null }> } | null;
  auditHidden: boolean; sensitiveHidden: boolean;
}
const Ctx = createContext<UserDetail | null>(null);
export function useUserDetail() { const u = useContext(Ctx); if (!u) throw new Error("useUserDetail outside UserShell"); return u; }

/** Shown when the id in the URL is not a person (or the viewer may not see that kind of account). */
function NotFound() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("dv3.u_not_found")} breadcrumbs={[{ label: t("nav.users"), href: "/admin/users" }, { label: t("rdp.not_found_crumb") }]} />
      <div data-testid="dv3-user-not-found"><EmptyState title={t("dv3.u_not_found")} hint={t("dv3.u_not_found_hint")} icon={<UserRound className="size-9" aria-hidden />} action={<Link href="/admin/users"><Button variant="secondary">{t("dv3.u_back")}</Button></Link>} /></div>
    </>
  );
}

/** The frame of the user view: breadcrumbs, header (who, state, source, the role-specific full view), account actions and the route sections. */
export function UserShell({ id, children }: { id: string; children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: u, error, mutate } = useApi<UserDetail>(`/admin/users/${id}/detail`, { shouldRetryOnError: false });
  const roles = useRoleNames(!!u?.staff?.staffRole); // the role's display name (custom roles have their own)
  if (error) return error instanceof ApiError && error.code === "NOT_FOUND" ? <NotFound /> : <><PageHeader title={t("nav.users")} breadcrumbs={[{ label: t("nav.users"), href: "/admin/users" }]} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!u) return <PageLoading />;
  const tabs = userTabs(u.role, (p) => hasPerm(me, p)).map((k) => ({ href: userTabHref(u.id, k), label: t(`dv3.ut_${k}`), count: k === "notes" && u.counts.notes ? u.counts.notes : undefined }));
  const entity = u.entity, staff = u.staff;
  return (
    <Ctx.Provider value={u}>
      <Breadcrumbs items={[{ label: t("nav.users"), href: "/admin/users" }, { label: u.name }]} />
      <DetailHeader name={u.name} avatar={<Avatar name={u.name} size={56} />}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">{t(`role.${u.role}`)}{staff?.staffRole && <><span aria-hidden>·</span>{roles.label(staff.staffRole)}</>}{entity && entity.name !== u.name && <><span aria-hidden>·</span>{entity.name}</>}</span>}
        badges={<>{u.status === "suspended" ? <Badge tone="danger">{t("status.suspended")}</Badge> : <StatusBadge status={u.status} />}{entity && <StatusBadge status={entity.verificationStatus} />}{staff?.locked && <Badge tone="danger"><ShieldAlert className="size-3" aria-hidden />{t("dv3.sec_locked")}</Badge>}{u.isDemo && <Badge>{t("dv3.demo")}</Badge>}</>}
        actions={<>
          {entity && <Link href={entity.href} data-testid="dv3-user-entity-link"><Button size="sm" variant="secondary">{t(`dv3.u_open_${entity.type}`)}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Button></Link>}
          {!staff && <AccountStatusButton user={u} onDone={() => void mutate()} />}
        </>}
        facts={[
          { label: t("auth.phone"), value: u.phone ? <span className="ltr-num" dir="ltr">{u.phone}</span> : "—" },
          { label: t("auth.email"), value: u.email ? <span dir="ltr" className="ltr-num break-all">{u.email}</span> : "—" },
          { label: t("reg.city"), value: u.city ? tx(`city.${u.city}`, u.city) : "—" },
          { label: t("rdp.fact_joined"), value: fmtDate(u.createdAt, locale) },
        ]} />
      <LinkTabs label={u.name} tabs={tabs} />
      {children}
    </Ctx.Provider>
  );
}

/** Wraps one section: someone who types the URL of a section they may not use sees a clear message instead of a failing request. */
export function UserTabGate({ tab, children }: { tab: UserTab; children: ReactNode }) {
  const { t } = useI18n(); const me = useUser(); const u = useUserDetail();
  if (userTabs(u.role, (p) => hasPerm(me, p)).includes(tab)) return <>{children}</>;
  return <EmptyState title={t("rdp.no_access")} hint={t("rdp.no_access_hint")} icon={<ShieldAlert className="size-9" aria-hidden />} action={<Link href={userTabHref(u.id, "overview")}><Button variant="secondary">{t("dv3.ut_overview")}</Button></Link>} />;
}
