"use client";
import Link from "next/link";
import { Users } from "lucide-react";
import { Badge, CellPair, EmptyState, ErrorState, PageLoading, Section, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { fmtDur } from "@/components/reports/chartTheme";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useOrder } from "./admin-order-ctx";
import { OfferCard } from "./admin-order-offer-card";

/** Offers that never became work (still waiting, declined, or expired) are listed compactly; every other offer gets a full card. */
const IDLE = ["offered", "rejected", "expired"];

/** Drivers & offers: one detailed card per driver who worked (or was supposed to work) on the order, then the other offers in a compact table. */
export function OrderDrivers() {
  const { t, locale } = useI18n(); const me = useUser();
  const { id, data: order, refresh, openModal } = useOrder();
  const { data, error, mutate } = useApi(`/admin/requests/${id}/offers`, { refreshInterval: 20000, keepPreviousData: true });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const items: any[] = data.items, work = items.filter((o) => !IDLE.includes(o.status)), idle = items.filter((o) => IDLE.includes(o.status));
  const r = order.request, open = ["published", "filling"].includes(r.status);
  const canDriver = hasPerm(me, "drivers.view");
  const ctx = { id, service: data.request.service, businessId: data.request.businessId };
  const done = () => { void refresh(); void mutate(); };
  return (
    <>
      <Section title={t("req.drivers")} description={t("rda.drivers_sub", { filled: r.slotsFilled, qty: r.quantity })} id="request-drivers" className="mb-5"
        actions={<Badge tone={r.slotsFilled >= r.quantity ? "success" : "warn"}><span className="ltr-num tabular-nums">{r.slotsFilled}/{r.quantity}</span></Badge>}>
        {work.length === 0
          ? <EmptyState icon={<Users className="size-9" aria-hidden />} title={t("req.no_drivers")} hint={t("req.no_drivers_hint")} action={open && hasPerm(me, "requests.assign") ? <button type="button" onClick={() => openModal("assign")} className="text-sm text-accent hover:underline">{t("admin.assign_driver")}</button> : undefined} />
          : <ul className="space-y-4" data-testid="dv1-offers">{work.map((o) => <OfferCard key={o.id} o={o} order={ctx} manifest={data.manifest} sensitive={data.sensitive} onDone={done} />)}</ul>}
      </Section>
      {idle.length > 0 && (
        <Section title={t("dv1.idle_title", { n: idle.length })} description={t("dv1.idle_sub")} flush className="mb-5" id="order-idle-offers">
          <Table bare stack label={t("dv1.idle_title", { n: idle.length })} head={[t("req.drivers"), t("dv1.col_source"), t("common.status"), t("dv1.col_offered"), t("dv1.col_response")]}>
            {idle.map((o) => (
              <tr key={o.id} data-testid={`admin-offer-${o.id}`} data-status={o.status}>
                <Td label={t("req.drivers")}><CellPair title={canDriver ? <Link href={`/admin/drivers/${o.driver.id}`} className="text-accent hover:underline">{o.driver.name}</Link> : o.driver.name} sub={o.office?.name ?? undefined} /></Td>
                <Td label={t("dv1.col_source")}>{t(`dv1.src_${o.source}`)}</Td>
                <Td label={t("common.status")}><StatusBadge status={o.status} /></Td>
                <Td label={t("dv1.col_offered")} className="whitespace-nowrap text-muted">{fmtDateTime(o.createdAt, locale)}</Td>
                <Td label={t("dv1.col_response")} className="text-muted"><span className="ltr-num">{o.responseS == null ? "—" : fmtDur(o.responseS, locale)}</span></Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  );
}
