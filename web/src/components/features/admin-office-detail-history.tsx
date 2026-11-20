"use client";
import Link from "next/link";
import { Link2, Link2Off, MailCheck, MailPlus, MailX, UserCheck } from "lucide-react";
import { useState } from "react";
import { Badge, EmptyState, ErrorState, PageLoading, Pagination, Section, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";

const KIND_ICON = { invite_sent: MailPlus, invite_accepted: MailCheck, invite_declined: MailX, invite_cancelled: MailX, linked: Link2, unlinked: Link2Off } as const;
const TONE: Record<string, string> = { invite_accepted: "text-accent", linked: "text-accent", unlinked: "text-danger", invite_declined: "text-danger", invite_cancelled: "text-muted", invite_sent: "text-cyan" };

/** Who joined and left the office and every invitation it sent: pending invites with their age, and the timeline of links, unlinks and answers. */
export function DriverHistory({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const canOpen = hasAny(me, "drivers.view", "users.view");
  const { data, error, mutate } = useApi(`/admin/offices/${id}/driver-history`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const inv = data.invites; const name = (e: any) => (e.driverId && canOpen ? <Link href={`/admin/drivers/${e.driverId}`} className="font-medium text-accent hover:underline">{e.driver ?? "—"}</Link> : <span className="font-medium">{e.driver ?? e.phone ?? "—"}</span>);
  return (
    <div className="space-y-5" data-testid="dv2-driver-history">
      <StatGrid cols={4}>
        <Stat label={t("dv2.hist_current")} icon={<UserCheck className="size-5" />} tone="accent" value={data.current.length} hint={t("dv2.hist_current_hint")} />
        <Stat label={t("dv2.hist_pending")} icon={<MailPlus className="size-5" />} tone={inv.pending ? "gold" : "muted"} value={inv.pending} hint={inv.pendingList[0] ? t("dv2.hist_oldest", { n: Math.max(...inv.pendingList.map((p: any) => p.ageDays)) }) : t("dv2.hist_none_waiting")} />
        <Stat label={t("dv2.hist_accepted")} tone="cyan" value={inv.accepted} hint={t("dv2.hist_sent", { n: inv.total })} />
        <Stat label={t("dv2.hist_declined")} tone={inv.declined ? "danger" : "muted"} value={inv.declined + inv.cancelled} hint={t("dv2.hist_declined_hint", { declined: inv.declined, cancelled: inv.cancelled })} />
      </StatGrid>
      <Section title={t("dv2.hist_title")} description={t("dv2.hist_sub")}>
        {data.events.length === 0 ? <EmptyState title={t("dv2.hist_none")} hint={t("dv2.hist_none_hint")} /> : (
          <ol className="space-y-3" data-testid="dv2-hist-events">
            {data.events.map((e: any) => { const Icon = KIND_ICON[e.kind as keyof typeof KIND_ICON] ?? Link2; return (
              <li key={e.id} className="flex items-start gap-3 text-sm" data-kind={e.kind}>
                <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[e.kind] ?? "text-muted"} rtl:-scale-x-100`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>{name(e)} <span className="text-muted">— {t(`dv2.hist_${e.kind}`)}</span>{e.via === "account.create" && <Badge className="ms-2">{t("dv2.hist_via_admin")}</Badge>}{e.kind === "unlinked" && e.via && <Badge className="ms-2">{t(`dv2.hist_by_${e.via}`)}</Badge>}</p>
                  {(e.by || e.phone) && <p className="text-xs text-muted">{e.by && <>{t("dv2.col_by")}: {e.by}</>}{e.by && e.phone && " · "}{e.phone && <span className="ltr-num">{e.phone}</span>}</p>}
                </div>
                <span className="ltr-num shrink-0 text-xs text-muted" title={fmtDateTime(e.at, locale)}>{fmtDate(e.at, locale)}</span>
              </li>
            ); })}
          </ol>
        )}
      </Section>
    </div>
  );
}

/** What the office's drivers did on its jobs (accepted, arrived, delivered, cancelled, no-show …), newest first. Needs `requests.view`. */
export function DriverEvents({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const [page, setPage] = useState(1);
  const allowed = hasAny(me, "requests.view"), canOpen = hasAny(me, "drivers.view", "users.view");
  const { data, error, mutate } = useApi(allowed ? `/admin/offices/${id}/driver-events${qs({ page, pageSize: 15 })}` : null, { keepPreviousData: true });
  if (!allowed) return null;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <Section title={t("dv2.dev_title")} description={t("dv2.dev_sub")}>
      {!data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("dv2.dev_none")} /> : (
        <>
          <ol className="divide-y divide-line/70" data-testid="dv2-driver-events">
            {data.items.map((e: any) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
                <span className="min-w-0">{canOpen ? <Link href={`/admin/drivers/${e.driverId}`} className="font-medium text-accent hover:underline">{e.driver}</Link> : <span className="font-medium">{e.driver}</span>}
                  <span className="text-muted"> — {tx(`event.${e.type}`, e.type)} · </span><Link href={`/admin/requests/${e.requestId}`} className="ltr-num text-accent hover:underline">{e.ref}</Link></span>
                <span className="ltr-num text-xs text-muted">{fmtDateTime(e.at, locale)}</span>
              </li>
            ))}
          </ol>
          <Pagination page={page} total={data.total} pageSize={15} onPage={setPage} />
        </>
      )}
    </Section>
  );
}
