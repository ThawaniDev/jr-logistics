"use client";
import Link from "next/link";
import { Activity, FileCheck2, Gauge, ShieldAlert } from "lucide-react";
import { Badge, EmptyState, ErrorState, InfoGrid, Notice, PageLoading, ProgressBar, Section, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { ratingText, strikeView } from "./admin-offices-lib";
import { Ago, KpiStrip, PeriodBar, PeriodNote, secondsSince, usePeriod } from "./admin-driver-common";
import { DeliveryCharts, DriverDistributions, MixCharts } from "./admin-driver-charts";

/** Overview of a driver: the period's KPIs and charts, standing (activity, strikes, suspension trail, documents), profile facts and the latest jobs. */
export function DriverOverview({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [period, setPeriod] = usePeriod("30d");
  const { data: d, error, mutate } = useApi(`/admin/drivers/${id}/overview`);
  const st = useApi(`/admin/drivers/${id}/standing`); const ins = useApi(`/admin/drivers/${id}/insights?period=${period}`, { keepPreviousData: true });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!d) return <PageLoading />;
  const sg = d.strikes; const strikes = strikeView(sg); const canRequest = hasAny(me, "requests.view"), canOffice = hasAny(me, "offices.view", "offices.manage");
  const stand = st.data; const x = ins.data; const loading = !x && !ins.error;
  const tone = strikes.level === "suspend" ? "danger" : strikes.level === "warn" ? "gold" : "accent";
  const docs = stand?.documents; const docsOk = docs ? docs.items.filter((i: any) => i.status === "approved").length : null;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5"><PeriodBar value={period} onChange={setPeriod} />{x && <PeriodNote period={x.period} generatedAt={x.generatedAt} />}</div>
      {ins.error && !x ? <ErrorState error={ins.error} retry={() => ins.mutate()} /> : (
        <>
          <KpiStrip label={t("rdq.kpis")} kpis={x?.kpis} loading={loading} comparing={!!x?.period.prevFrom} cols={4} />
          {x?.moneyHidden && <p className="text-xs text-muted">{t("dv2.money_hidden")}</p>}
        </>
      )}

      <section aria-label={t("dv2.standing")}>
        <StatGrid cols={4}>
          <Stat label={t("dv2.last_active")} icon={<Activity className="size-5" />} tone="cyan" loading={!stand && !st.error} value={stand ? <Ago seconds={secondsSince(stand.lastSeenAt)} /> : "—"}
            hint={stand?.lastLoginAt ? t("dv2.last_login", { d: fmtDateTime(stand.lastLoginAt, locale), n: stand.loginCount }) : t("dv2.never_signed_in")} />
          <Stat label={t("rdq.strikes_title")} icon={<ShieldAlert className="size-5" />} tone={tone} value={<span className="ltr-num">{strikes.count} / {sg.suspendAt}</span>} hint={t(`rdq.strike_${strikes.level}`)} />
          <Stat label={t("nav.documents")} icon={<FileCheck2 className="size-5" />} tone={docs && docsOk === docs.required ? "accent" : "gold"} loading={!stand && !st.error}
            value={docs ? <span className="ltr-num">{docsOk}/{docs.required}</span> : "—"} hint={docs ? t("dv2.docs_hint") : t("dv2.docs_hidden")} />
          <Stat label={t("dv2.lifetime")} icon={<Gauge className="size-5" />} tone="accent" loading={!stand && !st.error} value={stand ? stand.lifetime.completed : "—"}
            hint={stand ? t("dv2.lifetime_hint", { parcels: stand.lifetime.delivered, rating: ratingText(stand.rating.avg) }) : undefined} />
        </StatGrid>
      </section>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("rdq.strikes_title")} description={t("rdq.strikes_sub", { n: sg.windowDays })} id="rdq-driver-strikes">
          {!sg.policyEnabled ? <Notice tone="info">{t("rdq.strikes_off")}</Notice> : (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <p className="text-2xl font-bold tabular-nums"><span className="ltr-num">{strikes.count}</span><span className="text-base font-medium text-muted"> / <span className="ltr-num">{sg.suspendAt}</span></span></p>
                <Badge tone={strikes.level === "suspend" ? "danger" : strikes.level === "warn" ? "warn" : "success"}>{t(`rdq.strike_${strikes.level}`)}</Badge>
              </div>
              <ProgressBar value={strikes.count} max={sg.suspendAt} tone={tone === "gold" ? "gold" : tone === "danger" ? "danger" : "accent"} label={t("rdq.strikes_title")} />
              <p className="text-xs text-muted">{t("rdq.strikes_policy", { warn: sg.warnAt, suspend: sg.suspendAt, days: sg.suspendDays })}{sg.resetAt && <> · {t("rdq.strikes_reset", { d: fmtDateTime(sg.resetAt, locale) })}</>}</p>
            </div>
          )}
          {strikes.rows.length === 0 && <p className="mt-4 text-sm text-muted">{t("rdq.no_cancellations")}</p>}
          {strikes.rows.length > 0 && (
            <ul className="mt-4 divide-y divide-line/70 text-sm" data-testid="rdq-driver-cancellations">
              {strikes.rows.slice(0, 6).map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">{canRequest && e.requestId ? <Link href={`/admin/requests/${e.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{e.ref}</Link> : <span className="ltr-num font-semibold">{e.ref}</span>}<span className="text-muted">{e.reason ?? ""}</span></span>
                  <span className="flex items-center gap-2 text-xs text-muted">{fmtDate(e.at, locale)}<Badge tone={e.counted ? "warn" : "neutral"}>{e.counted ? t("rdq.strike_counted") : t("rdq.strike_not_counted")}</Badge></span>
                </li>
              ))}
            </ul>
          )}
          {stand && stand.suspension.trail.length > 0 && (
            <div className="mt-4 border-t border-line pt-3" data-testid="dv2-suspension-trail">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("dv2.suspension_trail")}</h3>
              <ul className="space-y-2 text-sm">
                {stand.suspension.trail.map((a: any) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span><span className="font-medium">{t(`dv2.trail_${String(a.action).replace(".", "_")}`)}</span>{a.reason && <span className="text-muted"> — {a.reason}</span>}{a.cancellations != null && <span className="text-muted"> — {t("dv2.trail_cancellations", { n: a.cancellations })}</span>}{a.by && <span className="text-muted"> · {a.by}</span>}</span>
                    <span className="ltr-num text-xs text-muted">{fmtDateTime(a.at, locale)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title={t("adm.details")}>
          <InfoGrid cols={2} items={[
            { label: t("auth.phone"), value: <span className="ltr-num">{d.phone ?? "—"}</span> },
            { label: t("reg.national_id"), value: <span className="ltr-num">{d.nationalId ?? t("adm.restricted")}</span> },
            { label: t("reg.plate"), value: <span className="ltr-num">{d.vehiclePlate ?? "—"}</span> },
            { label: t("wizard.vehicle"), value: d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—" },
            { label: t("reg.temperature"), value: d.vehicleTemperature ? t(`temp.${d.vehicleTemperature}`) : "—" },
            { label: t("reg.city"), value: tx(`city.${d.city}`, d.city) },
            { label: t("reg.services"), value: (d.services ?? []).length ? (d.services as string[]).map((k) => t(`svc.${k}`)).join(", ") : "—" },
            { label: t("adm.availability"), value: <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge> },
            { label: t("role.office"), value: d.office ? (canOffice && d.officeId ? <Link href={`/admin/offices/${d.officeId}`} className="text-accent hover:underline">{d.office}</Link> : d.office) : t("adm.direct_driver") },
            ...(d.office ? [{ label: t("adm.link_status"), value: d.officeLinkStatus === "linked" ? t("adm.linked") : t("adm.direct") }] : []),
            ...(stand ? [
              { label: t("dv2.account_source"), value: <>{t(`dv2.source_${stand.source}`)}{stand.createdBy && <span className="text-muted"> · {stand.createdBy.name}</span>}</> },
              { label: t("dv2.language"), value: t(`dv2.lang_${stand.language}`) },
              { label: t("dv2.last_login_client"), value: stand.lastLoginClient ? t(`dv2.client_${stand.lastLoginClient}`) : "—" },
            ] : []),
          ]} />
        </Section>
      </div>

      {docs && docs.items.length > 0 && (
        <Section title={t("dv2.docs_status")} description={t("dv2.docs_status_sub")} flush>
          <Table stack bare dense label={t("dv2.docs_status")} head={[t("verify.doc_type"), t("common.status"), t("docs.expires")]}>
            {docs.items.map((i: any) => (
              <tr key={i.type} data-testid={`dv2-doc-${i.type}`}>
                <Td><span className="font-medium">{t(`doc.${i.type}`)}</span></Td>
                <Td label={t("common.status")}><StatusBadge status={i.status} ns="docstatus" /></Td>
                <Td label={t("docs.expires")}>{i.expiresOn ? <span className="inline-flex flex-wrap items-center gap-1.5">{fmtDate(i.expiresOn, locale)}{i.daysLeft != null && i.daysLeft < 0 && <Badge tone="danger">{t("ubz.doc_expired")}</Badge>}{i.daysLeft != null && i.daysLeft >= 0 && i.daysLeft <= 30 && <Badge tone="warn">{t("ubz.doc_expiring", { n: i.daysLeft })}</Badge>}</span> : "—"}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {x && (
        <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0" data-testid="dv2-charts">
          <DeliveryCharts series={x.series} prev={x.prevSeries} bucket={x.period.bucket} testId="dv2-drv" />
          <DriverDistributions ratings={x.ratings} response={x.response} heatmap={x.heatmap} testId="dv2-drv" />
          <MixCharts failures={x.failures} cities={x.cities} companies={x.companies} testId="dv2-drv" />
        </div>
      )}

      <Section title={t("adm.recent_jobs")} flush actions={<Link href={`/admin/drivers/${id}/jobs`} className="text-sm font-medium text-accent hover:underline">{t("common.view_all")}</Link>}>
        {(d.recent ?? []).length === 0 ? <div className="p-4"><EmptyState title={t("rdq.jobs_none")} hint={t("rdq.jobs_none_driver_hint")} /></div> : (
          <Table stack bare dense label={t("adm.recent_jobs")} head={[t("req.ref"), t("common.status"), t("common.date")]}>
            {d.recent.map((r: any) => (
              <tr key={r.offerId}>
                <Td>{canRequest ? <Link href={`/admin/requests/${r.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{r.ref}</Link> : <span className="ltr-num font-semibold">{r.ref}</span>}</Td>
                <Td label={t("common.status")}><StatusBadge status={r.status} /></Td>
                <Td label={t("common.date")} className="text-muted">{fmtDateTime(r.at, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
