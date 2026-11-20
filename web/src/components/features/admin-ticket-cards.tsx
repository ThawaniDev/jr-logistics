"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Avatar, Badge, Notice, Section, StatusBadge } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { RoleBadge } from "./admin-system-common";
import { ENTITY_PERMS } from "./admin-system-lib";

export interface PersonCard {
  id: string; name: string; company: string | null; role: string; status: string; city: string | null; phone: string | null; email: string | null; createdAt: string; lastSeenAt: string | null; href: string; userHref: string;
  stats: { tickets: { total: number; open: number } | null; complaints: { total: number; open: number } | null; orders: number | null; rating: { avg: number; count: number } | null; lastTickets: Array<{ id: string; ref: string; subject: string; status: string; createdAt: string }> | null };
}
export interface Related {
  request: { id: string; ref: string; status: string; service: string; title: string | null; pickupCity: string; deliveryCity: string; startsAt: string; createdAt: string; completedAt: string | null; cancelledAt: string | null; cancelReason: string | null; quantity: number; slotsFilled: number; createdVia: string; totalCents: number | null } | null;
  offer: { id: string; status: string; acceptedAt: string | null; arrivedAt: string | null; deliveredAt: string | null; expectedUnits: number; deliveredUnits: number | null; finalUnits: number | null; expectedEarningCents: number | null; driver: { id: string; name: string }; office: { id: string; name: string } | null } | null;
  driver: { id: string; name: string; status: string; city: string | null; vehicleType: string | null; availability: string | null; verificationStatus: string | null; jobsCompleted: number; rating: number | null; href: string } | null;
  company: { id: string; name: string; status: string; city: string | null; verificationStatus: string | null; orders: number; href: string } | null;
  hidden: string[];
}

/** Whether the signed-in staff member may open the page of a person of this role (same permissions as the sidebar entries). */
export function usePersonLink() {
  const me = useUser();
  return (role: string | null | undefined) => (role === "staff" || role === "admin" ? hasAny(me, "staff.view", "staff.manage") : hasAny(me, ...(ENTITY_PERMS[role ?? ""] ?? [])));
}
export const useCanOpenUser = () => { const me = useUser(); return hasAny(me, "users.view", "drivers.view", "offices.view"); };
/** A staff member's name as a link to their user page (`/admin/users/:id`) when the signed-in person may open staff accounts; plain text otherwise. */
export function StaffLink({ id, children, testId }: { id: string | null | undefined; children: ReactNode; testId?: string }) {
  const me = useUser();
  if (!id || !hasAny(me, "staff.view", "staff.manage")) return <>{children}</>;
  return <Link href={`/admin/users/${id}`} data-testid={testId} className="text-accent hover:underline">{children}</Link>;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 py-1.5 text-sm"><dt className="shrink-0 text-muted">{label}</dt><dd className="min-w-0 break-words text-end font-medium">{children}</dd></div>;
}
function Card({ title, children, testId, action }: { title: string; children: ReactNode; testId: string; action?: ReactNode }) {
  return <Section title={title} actions={action}><div data-testid={testId}>{children}</div></Section>;
}

/** The person who opened a ticket / filed a complaint: who they are, how they reached us before, and where their own page is. */
export function PersonCardView({ p, title, testId }: { p: PersonCard | null; title: string; testId: string }) {
  const { t, locale } = useI18n(); const tx = useTx(); const open = usePersonLink(); const canUser = useCanOpenUser();
  if (!p) return null;
  const linked = open(p.role), s = p.stats;
  return (
    <Card title={title} testId={testId} action={canUser ? <Link href={p.userHref} className="text-sm text-accent hover:underline" data-testid={`${testId}-user-link`}>{t("dv3.tk_user_page")}</Link> : undefined}>
      <div className="mb-3 flex items-center gap-3">
        <Avatar name={p.name} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{linked ? <Link href={p.href} className="text-accent hover:underline" data-testid={`${testId}-link`}>{p.name}</Link> : p.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><RoleBadge role={p.role} />{p.company && p.company !== p.name && <span className="truncate">{p.company}</span>}{p.status === "suspended" && <Badge tone="danger">{t("status.suspended")}</Badge>}</p>
        </div>
      </div>
      <dl className="divide-y divide-line/50">
        {p.city && <Line label={t("reg.city")}>{tx(`city.${p.city}`, p.city)}</Line>}
        <Line label={t("auth.phone")}>{p.phone ? <span className="ltr-num" dir="ltr">{p.phone}</span> : "—"}</Line>
        {p.email && <Line label={t("auth.email")}><span className="ltr-num break-all" dir="ltr">{p.email}</span></Line>}
        <Line label={t("dv3.tk_member_since")}>{fmtDate(p.createdAt, locale)}</Line>
        {p.lastSeenAt && <Line label={t("dv3.f_last_seen")}>{fmtDateTime(p.lastSeenAt, locale)}</Line>}
        {s.orders != null && <Line label={t(p.role === "business" ? "dv3.tk_orders" : "dv3.tk_jobs")}><span className="ltr-num">{fmtNum(s.orders, locale)}</span></Line>}
        {s.rating && <Line label={t("dv3.u_rating")}><span className="inline-flex items-center gap-1 text-gold"><Star className="size-3.5 fill-current" aria-hidden /><span className="ltr-num">{s.rating.avg}</span><span className="text-xs text-muted">({fmtNum(s.rating.count, locale)})</span></span></Line>}
        {s.tickets && <Line label={t("dv3.u_tickets")}><span className="ltr-num" data-testid={`${testId}-tickets`}>{t("dv3.tk_open_of", { open: s.tickets.open, total: s.tickets.total })}</span></Line>}
        {s.complaints && <Line label={t("dv3.u_complaints")}><span className="ltr-num">{t("dv3.tk_open_of", { open: s.complaints.open, total: s.complaints.total })}</span></Line>}
      </dl>
      {s.lastTickets && s.lastTickets.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">{t("dv3.tk_last_tickets")}</p>
          <ul className="space-y-1.5" data-testid={`${testId}-last`}>
            {s.lastTickets.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/admin/cases/${x.id}`} className="min-w-0 truncate text-accent hover:underline"><span className="ltr-num font-medium">{x.ref}</span> <span dir="auto" className="text-muted">{x.subject}</span></Link>
                <StatusBadge status={x.status} />
              </li>))}
          </ul>
        </div>)}
    </Card>
  );
}

/** The request, job, driver and company the case points at, each with its key facts and a link. Cards the viewer may not open are named in a short notice. */
export function RelatedCardsView({ r }: { r: Related | null }) {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser(); const canReq = hasAny(me, "requests.view"), canDrv = hasAny(me, "drivers.view"), canCo = hasAny(me, "users.view", "verification.manage", "offices.view");
  if (!r) return null;
  const q = r.request, o = r.offer, d = r.driver, c = r.company;
  if (!q && !o && !d && !c && r.hidden.length === 0) return null;
  const m = (n: number | null) => (n == null ? null : fmtMoney(n, locale));
  return (
    <div className="space-y-5" data-testid="dv3-related">
      {r.hidden.length > 0 && <Notice tone="info">{t("dv3.hidden_parts", { parts: r.hidden.map((h) => t(`dv3.hid_${h}`)).join(", ") })}</Notice>}
      {q && (
        <Card title={t("dv3.rel_request")} testId="dv3-rel-request" action={canReq ? <Link href={`/admin/requests/${q.id}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">{t("adm.open_request")}<ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden /></Link> : undefined}>
          <p className="mb-2 flex flex-wrap items-center gap-2"><span className="ltr-num font-semibold">{q.ref}</span><StatusBadge status={q.status} /></p>
          <dl className="divide-y divide-line/50">
            <Line label={t("req.service")}>{tx(`svc.${q.service}`, q.service)}</Line>
            <Line label={t("req.route")}>{tx(`city.${q.pickupCity}`, q.pickupCity)} <ArrowRight className="mx-0.5 inline size-3 rtl:rotate-180" aria-hidden /> {tx(`city.${q.deliveryCity}`, q.deliveryCity)}</Line>
            <Line label={t("req.starts")}>{fmtDateTime(q.startsAt, locale)}</Line>
            <Line label={t("req.slots")}><span className="ltr-num">{q.slotsFilled}/{q.quantity}</span></Line>
            <Line label={t("dv3.rel_created")}>{fmtDateTime(q.createdAt, locale)}</Line>
            {q.completedAt && <Line label={t("dv3.rel_completed")}>{fmtDateTime(q.completedAt, locale)}</Line>}
            {q.cancelledAt && <Line label={t("dv3.rel_cancelled")}>{fmtDateTime(q.cancelledAt, locale)}{q.cancelReason && <span className="block text-xs font-normal text-muted">{q.cancelReason}</span>}</Line>}
            {m(q.totalCents) && <Line label={t("req.total")}>{m(q.totalCents)}</Line>}
          </dl>
        </Card>)}
      {o && (
        <Card title={t("dv3.rel_job")} testId="dv3-rel-offer">
          <p className="mb-2 flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /></p>
          <dl className="divide-y divide-line/50">
            <Line label={t("adm.col_driver")}>{canDrv ? <Link href={`/admin/drivers/${o.driver.id}`} className="text-accent hover:underline">{o.driver.name}</Link> : o.driver.name}</Line>
            {o.office && <Line label={t("role.office")}>{hasAny(me, "offices.view", "offices.manage") ? <Link href={`/admin/offices/${o.office.id}`} className="text-accent hover:underline">{o.office.name}</Link> : o.office.name}</Line>}
            {o.acceptedAt && <Line label={t("dv3.rel_accepted")}>{fmtDateTime(o.acceptedAt, locale)}</Line>}
            {o.arrivedAt && <Line label={t("dv3.rel_arrived")}>{fmtDateTime(o.arrivedAt, locale)}</Line>}
            {o.deliveredAt && <Line label={t("dv3.rel_delivered")}>{fmtDateTime(o.deliveredAt, locale)}</Line>}
            <Line label={t("dv3.rel_units")}><span className="ltr-num">{t("dv3.rel_units_v", { expected: o.expectedUnits, delivered: o.deliveredUnits ?? "—", final: o.finalUnits ?? "—" })}</span></Line>
            {m(o.expectedEarningCents) && <Line label={t("dv3.rel_earning")}>{m(o.expectedEarningCents)}</Line>}
          </dl>
        </Card>)}
      {d && (
        <Card title={t("dv3.rel_driver")} testId="dv3-rel-driver" action={canDrv ? <Link href={d.href} className="text-sm text-accent hover:underline">{d.name}</Link> : undefined}>
          <dl className="divide-y divide-line/50">
            <Line label={t("common.status")}><StatusBadge status={d.status} /></Line>
            {d.vehicleType && <Line label={t("reg.vehicle")}>{t(`vehicle.${d.vehicleType}`)}</Line>}
            {d.availability && <Line label={t("dv3.u_availability")}>{t(`dv3.u_avail_${d.availability}`)}</Line>}
            {d.verificationStatus && <Line label={t("verify.title")}><StatusBadge status={d.verificationStatus} /></Line>}
            <Line label={t("dv3.u_jobs")}><span className="ltr-num">{fmtNum(d.jobsCompleted, locale)}</span></Line>
            {d.rating != null && <Line label={t("dv3.u_rating")}><span className="ltr-num">{d.rating}</span></Line>}
          </dl>
        </Card>)}
      {c && (
        <Card title={t("dv3.rel_company")} testId="dv3-rel-company" action={canCo ? <Link href={c.href} className="text-sm text-accent hover:underline">{c.name}</Link> : undefined}>
          <dl className="divide-y divide-line/50">
            <Line label={t("common.status")}><StatusBadge status={c.status} /></Line>
            {c.verificationStatus && <Line label={t("verify.title")}><StatusBadge status={c.verificationStatus} /></Line>}
            {c.city && <Line label={t("reg.city")}>{tx(`city.${c.city}`, c.city)}</Line>}
            <Line label={t("dv3.tk_orders")}><span className="ltr-num">{fmtNum(c.orders, locale)}</span></Line>
          </dl>
        </Card>)}
    </div>
  );
}
