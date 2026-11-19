"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, MapPin } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, Section, Segmented, Skeleton, Table, Td, useAction } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { LinkButton, hasAny, useTx } from "./admin-common";
import { alertCounts, alertTarget, SEVERITIES, type AlertSeverity, type OpsAlert } from "./admin-ops-lib";

const TONE = { critical: "danger", warning: "warn", info: "info" } as const;

/** The second line of an alert: the request ref and whatever identifies the case (driver, owner, document, time, open slots). */
function useAlertSub() {
  const { t, locale } = useI18n(); const tx = useTx();
  return (a: OpsAlert): React.ReactNode => {
    const d = (a.detail ?? {}) as Record<string, unknown>;
    const parts: React.ReactNode[] = [];
    if (a.ref) parts.push(<span key="ref" className="ltr-num">{a.ref}</span>);
    const who = (d.driver ?? d.owner) as string | undefined; if (who) parts.push(who);
    if (d.type) parts.push(tx(`doc.${d.type}`, d.type));
    if (d.expiresOn) parts.push(t("rda.expires_on", { date: fmtDate(String(d.expiresOn), locale) }));
    if (d.startsAt) parts.push(fmtDateTime(String(d.startsAt), locale));
    if (typeof d.open === "number" && d.open > 0) parts.push(t("ops.open_slots", { n: d.open }));
    if (typeof d.count === "number") parts.push(t("rda.alert_count", { n: d.count }));
    return parts.length ? parts.flatMap((p, i) => (i ? [<span key={`s${i}`} aria-hidden> · </span>, p] : [p])) : null;
  };
}

/** The alert queue: filter by severity, and every alert has its next step (open the request, find drivers, or the page that handles it). */
export function AlertsSection({ items, error, onRetry, onChanged }: { items: OpsAlert[] | undefined; error: unknown; onRetry: () => void; onChanged: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const sub = useAlertSub();
  const [sev, setSev] = useState<"" | AlertSeverity>("");
  const counts = alertCounts(items);
  const shown = (items ?? []).filter((x) => !sev || x.severity === sev);
  const canRematch = hasAny(me, "replacements.manage", "requests.assign");
  const filter = items && items.length > 0 ? (
    <Segmented label={t("rda.severity")} value={sev} onChange={(k) => setSev(k as "" | AlertSeverity)}
      options={[{ key: "", label: t("common.all"), count: items.length }, ...SEVERITIES.map((s) => ({ key: s, label: t(`ops.sev_${s}`), count: counts[s] }))]} />
  ) : null;
  const target = (al: OpsAlert) => {
    const k = alertTarget(al);
    if (k === "request" && al.requestId) return <LinkButton size="sm" href={`/admin/requests/${al.requestId}`} data-testid="admin-alert-open">{t("common.open")}</LinkButton>;
    if (k === "verification" && hasAny(me, "verification.manage", "documents.review", "offices.view")) return <LinkButton size="sm" href="/admin/verification">{t("nav.verification")}</LinkButton>;
    if (k === "settlements" && hasAny(me, "finance.view", "settlements.review")) return <LinkButton size="sm" href="/admin/finance/settlements">{t("nav.settlements")}</LinkButton>;
    return null;
  };
  return (
    <Section title={t("ops.alerts")} description={t("rda.alerts_sub")} flush className="mb-6" id="alerts">
      {filter && <div className="border-b border-line px-5 py-3">{filter}</div>}
      {error ? <div className="p-5"><ErrorState error={error} retry={onRetry} /></div>
        : !items ? <div className="space-y-2 p-5" aria-busy="true"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        : items.length === 0 ? <div className="p-5"><EmptyState icon={<CheckCircle2 className="size-9 text-accent" aria-hidden />} title={t("ops.all_clear")} hint={t("rda.all_clear_hint")} /></div>
        : shown.length === 0 ? <div className="p-5"><EmptyState title={t("common.no_results")} action={<Button variant="secondary" onClick={() => setSev("")}>{t("uxa.clear_filters")}</Button>} /></div>
        : (
          <Table bare stack head={[t("rda.severity"), t("rda.alert"), { label: t("rda.next_step"), align: "end" }]} label={t("ops.alerts")}>
            {shown.map((al, i) => (
              <tr key={`${al.type}-${al.offerId ?? al.requestId ?? i}-${i}`} data-testid="admin-alert-row">
                <Td label={t("rda.severity")}><Badge tone={TONE[al.severity]}>{t(`ops.sev_${al.severity}`)}</Badge></Td>
                <Td label={t("rda.alert")}><CellPair title={t(`alert.${al.type}`)} sub={sub(al)} className="max-w-md" /></Td>
                <Td align="end" className="whitespace-nowrap">
                  <div className="flex w-full flex-wrap items-center justify-end gap-2">
                    {al.type === "unfilled_soon" && canRematch && <Button size="sm" data-testid="admin-alert-rematch" loading={a.is(al.requestId ?? "")} onClick={() => a.run(al.requestId ?? "", () => post(`/admin/requests/${al.requestId}/rematch`), { success: "ops.rematched", onDone: onChanged })}>{t("ops.rematch")}</Button>}
                    {target(al)}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
    </Section>
  );
}

/** Today's operations per pickup city, with how many drivers are available there. */
export function CitiesSection({ data, error, onRetry }: { data: { items: Array<{ city: string; open: number; active: number; completed: number; lost: number; driversAvailable: number; driversTotal: number }> } | undefined; error: unknown; onRetry: () => void }) {
  const { t } = useI18n(); const tx = useTx();
  return (
    <Section title={t("adm.city_summary")} description={t("adm.city_summary_sub")} flush id="cities">
      {error ? <div className="p-5"><ErrorState error={error} retry={onRetry} /></div>
        : !data ? <div className="space-y-2 p-5" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        : data.items.length === 0 ? <div className="p-5"><EmptyState icon={<MapPin className="size-9" aria-hidden />} title={t("common.no_results")} hint={t("rda.cities_empty_hint")} action={<Link href="/admin/requests" className="text-sm text-accent hover:underline">{t("nav.requests")}</Link>} /></div>
        : (
          <Table bare stack label={t("adm.city_summary")} head={[t("wizard.pickup_city"), { label: t("adm.open_requests"), align: "end" }, { label: t("adm.active_requests"), align: "end" }, { label: t("status.completed"), align: "end" }, { label: t("adm.lost_requests"), align: "end" }, { label: t("adm.drivers_available"), align: "end" }]}>
            {data.items.map((c) => (
              <tr key={c.city}>
                <Td label={t("wizard.pickup_city")} className="font-medium">{tx(`city.${c.city}`, c.city)}</Td>
                <Td label={t("adm.open_requests")} num>{c.open}</Td>
                <Td label={t("adm.active_requests")} num>{c.active}</Td>
                <Td label={t("status.completed")} num>{c.completed}</Td>
                <Td label={t("adm.lost_requests")} num className={c.lost ? "text-danger" : undefined}>{c.lost}</Td>
                <Td label={t("adm.drivers_available")} num><span className={c.driversAvailable ? "text-accent" : "text-muted"}>{c.driversAvailable}</span><span className="text-muted"> / {c.driversTotal}</span></Td>
              </tr>
            ))}
          </Table>
        )}
    </Section>
  );
}
