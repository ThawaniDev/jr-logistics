"use client";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, InfoGrid, Notice, PageLoading, ProgressBar, Section, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { ratingText, strikeView } from "./admin-offices-lib";

/** Overview tab of a driver: KPIs, the strike policy standing, profile details, affiliation and the latest jobs. */
export function DriverOverview({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: d, error, mutate } = useApi(`/admin/drivers/${id}/overview`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!d) return <PageLoading />;
  const s = d.stats ?? {}; const st = d.strikes; const strikes = strikeView(st); const canRequest = hasAny(me, "requests.view"); const canOffice = hasAny(me, "offices.view", "offices.manage");
  const tone = strikes.level === "suspend" ? "danger" : strikes.level === "warn" ? "gold" : "accent";
  return (
    <div className="space-y-5">
      <section aria-label={t("rdq.kpis")}>
        <StatGrid cols={5}>
          <Stat label={t("driver.completed")} value={s.completed ?? 0} tone="accent" href={`/admin/drivers/${id}/jobs`} hint={t("adm.units_total", { n: s.units ?? 0 })} />
          <Stat label={t("adm.cancelled_jobs")} value={s.cancelled ?? 0} tone={s.cancelled ? "gold" : "muted"} hint={t("adm.policy_window", { n: s.cancelPolicyWindowDays ?? 0 })} />
          <Stat label={t("status.no_show")} value={s.noShow ?? 0} tone={s.noShow ? "danger" : "muted"} />
          <Stat label={t("status.replaced")} value={s.replaced ?? 0} tone="muted" />
          <Stat label={t("driver.rating")} value={ratingText(d.rating)} tone="gold" hint={t("adm.ratings_n", { n: d.ratingCount ?? 0 })} />
        </StatGrid>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("rdq.strikes_title")} description={t("rdq.strikes_sub", { n: st.windowDays })} id="rdq-driver-strikes">
          {!st.policyEnabled ? <Notice tone="info">{t("rdq.strikes_off")}</Notice> : (
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <p className="text-2xl font-bold tabular-nums"><span className="ltr-num">{strikes.count}</span><span className="text-base font-medium text-muted"> / <span className="ltr-num">{st.suspendAt}</span></span></p>
                <Badge tone={strikes.level === "suspend" ? "danger" : strikes.level === "warn" ? "warn" : "success"}>{t(`rdq.strike_${strikes.level}`)}</Badge>
              </div>
              <ProgressBar value={strikes.count} max={st.suspendAt} tone={tone === "gold" ? "gold" : tone === "danger" ? "danger" : "accent"} label={t("rdq.strikes_title")} />
              <p className="text-xs text-muted">{t("rdq.strikes_policy", { warn: st.warnAt, suspend: st.suspendAt, days: st.suspendDays })}{st.resetAt && <> · {t("rdq.strikes_reset", { d: fmtDateTime(st.resetAt, locale) })}</>}</p>
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
        </Section>

        <Section title={t("adm.details")}>
          <InfoGrid cols={2} items={[
            { label: t("auth.phone"), value: <span className="ltr-num">{d.phone ?? "—"}</span> },
            { label: t("reg.national_id"), value: <span className="ltr-num">{d.nationalId ?? t("adm.restricted")}</span> },
            { label: t("reg.plate"), value: <span className="ltr-num">{d.vehiclePlate ?? "—"}</span> },
            { label: t("wizard.vehicle"), value: d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—" },
            { label: t("reg.temperature"), value: d.vehicleTemperature ? t(`temp.${d.vehicleTemperature}`) : "—" },
            { label: t("reg.city"), value: tx(`city.${d.city}`, d.city) },
            { label: t("reg.services"), value: (d.services ?? []).length ? (d.services as string[]).map((x) => t(`svc.${x}`)).join(", ") : "—" },
            { label: t("adm.availability"), value: <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge> },
            { label: t("role.office"), value: d.office ? (canOffice && d.officeId ? <Link href={`/admin/offices/${d.officeId}`} className="text-accent hover:underline">{d.office}</Link> : d.office) : t("adm.direct_driver") },
            ...(d.office ? [{ label: t("adm.link_status"), value: d.officeLinkStatus === "linked" ? t("adm.linked") : t("adm.direct") }] : []),
          ]} />
        </Section>
      </div>

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
