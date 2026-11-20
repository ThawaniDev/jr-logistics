"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CellPair, ProgressBar, StatusBadge, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useCityNames } from "./admin-common";

type TFn = (k: string, v?: Record<string, string | number>) => string;
/** Delivery requests: parcel count from the row (billable units), else the most the drivers can carry. */
export function parcelLabel(x: any, t: TFn): string | null {
  if (x.service !== "delivery_driver") return null;
  const n = x.pricingSnapshot?.totalUnits;
  if (typeof n === "number" && n > 0) return n === 1 ? t("rda.parcel_one") : t("shipadm.parcels_n", { n });
  if (x.shipmentsPerDriver && x.quantity) return t("shipadm.parcels_upto", { n: x.shipmentsPerDriver * x.quantity });
  return null;
}

/** "Riyadh → Jeddah" (the arrow flips in right-to-left languages). */
export function RouteText({ from, to }: { from: string; to: string }) {
  const { name } = useCityNames();
  return <span className="inline-flex flex-wrap items-center gap-x-1.5">{name(from)}<ArrowRight className="size-3.5 shrink-0 text-muted rtl:rotate-180" aria-hidden />{name(to)}</span>;
}

/** The request list: one row per request, the company and the request each open their own view. `parcel` carries a pasted parcel code into the detail page. */
export function RequestsTable({ items, parcel }: { items: any[]; parcel?: string }) {
  const { t, locale } = useI18n(); const me = useUser();
  const canCompany = hasAny(me, "users.view", "verification.manage", "offices.view");
  const head = [t("req.ref"), t("req.service"), t("req.route"), t("req.starts"), t("req.slots"), { label: t("req.total"), align: "end" as const }, t("common.status")];
  return (
    <Table stack head={head} label={t("nav.requests")}>
      {items.map((x) => {
        const biz = x.businessName ?? x.business?.name;
        const parcels = parcelLabel(x, t);
        const full = x.slotsFilled >= x.quantity;
        return (
          <tr key={x.id} data-testid="admin-request-row" data-ref={x.ref}>
            <Td label={t("req.ref")}>
              <CellPair
                title={<Link href={`/admin/requests/${x.id}${parcel ? `/parcels${qs({ q: parcel })}` : ""}`} className="ltr-num text-accent hover:underline" data-testid="admin-request-link">{x.ref}</Link>}
                sub={biz ? <>{canCompany && x.businessId ? <Link href={`/admin/companies/${x.businessId}`} className="hover:text-ink hover:underline" data-testid="admin-request-company">{biz}</Link> : biz}{x.businessPhone ? <> · <span className="ltr-num">{x.businessPhone}</span></> : null}</> : undefined}
              />
            </Td>
            <Td label={t("req.service")}>{t(`svc.${x.service}`)}</Td>
            <Td label={t("req.route")} className="text-muted"><RouteText from={x.pickupCity} to={x.deliveryCity} /></Td>
            <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDateTime(x.startsAt, locale)}</Td>
            <Td label={t("req.slots")}>
              <div className="min-w-24">
                <span className="ltr-num tabular-nums">{x.slotsFilled}/{x.quantity}</span>
                <div className="mt-1 max-w-24"><ProgressBar value={x.slotsFilled} max={x.quantity} tone={full ? "accent" : x.slotsFilled > 0 ? "gold" : "cyan"} label={t("req.slots")} /></div>
                {parcels && <p className="mt-1 text-xs text-muted">{parcels}</p>}
              </div>
            </Td>
            <Td label={t("req.total")} num>{fmtMoney(x.totalCents, locale)}</Td>
            <Td label={t("common.status")}><StatusBadge status={x.status} /></Td>
          </tr>
        );
      })}
    </Table>
  );
}
