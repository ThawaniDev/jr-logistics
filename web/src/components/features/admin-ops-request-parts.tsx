"use client";
import Link from "next/link";
import { Badge, KV, Notice, Section } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { hasAny, qs } from "./admin-common";

/** Where the work is and what is being carried: addresses, vehicle, parcel counts and notes. */
export function DetailsSection({ data }: { data: any }) {
  const { t } = useI18n(); const r = data.request;
  return (
    <Section title={t("rda.details")} id="request-details">
      <dl>
        <KV label={t("wizard.vehicle")}>{r.vehicleType ? t(`vehicle.${r.vehicleType}`) : "—"}</KV>
        <KV label={t("wizard.pickup_address")}>{r.pickupAddress ?? "—"}</KV>
        {data.manifest ? <>
          <KV label={t("shipadm.parcels")}><span className="tabular-nums">{r.pricingSnapshot?.totalUnits ?? "—"}</span></KV>
          <KV label={t("shipadm.per_driver")}><span className="tabular-nums">{r.shipmentsPerDriver ?? "—"}</span></KV>
          <KV label={t("shipadm.unassigned")}><span className={data.unassignedParcels > 0 ? "font-semibold text-danger" : "tabular-nums"}>{data.unassignedParcels ?? 0}</span></KV>
        </> : <>
          <KV label={t("wizard.delivery_address")}>{r.deliveryAddress ?? "—"}</KV>
          <KV label={t("wizard.recipient_name")}>{r.recipientName ?? "—"}</KV>
        </>}
        <KV label={t("wizard.notes")}>{r.notes ?? "—"}</KV>
      </dl>
      {data.manifest && r.allowPartial === false && <div className="mt-3"><Badge tone="warn">{t("shipadm.all_or_nothing")}</Badge><p className="mt-1 text-xs text-muted">{t("shipadm.all_or_nothing_hint")}</p></div>}
      {data.manifest && data.unassignedParcels > 0 && <div className="mt-3"><Notice tone="warn">{t("shipadm.unassigned_note", { n: data.unassignedParcels })}</Notice></div>}
    </Section>
  );
}

/** The ordering company: name (opens the company view), phone, CR number, and the places related to it. The company record needs `users.view`. */
export function BusinessSection({ requestId, businessId, biz }: { requestId: string; businessId: string; biz: { data?: any; error?: unknown } }) {
  const { t } = useI18n(); const me = useUser();
  const name = biz.data?.profile?.companyName ?? biz.data?.user?.name;
  const canCompany = hasAny(me, "users.view", "verification.manage", "offices.view");
  const links = (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
      {canCompany && <Link href={`/admin/companies/${businessId}`} className="text-accent hover:underline" data-testid="admin-req-open-company">{t("uxa.open_account")}</Link>}
      {hasAny(me, "requests.view") && name && <Link href={`/admin/integrations${qs({ q: name })}`} className="text-accent hover:underline">{t("uxa.open_integrations")}</Link>}
      {hasAny(me, "finance.view", "wallets.view") && <Link href={`/admin/finance/ledger${qs({ request: requestId })}`} className="text-accent hover:underline" data-testid="admin-req-open-ledger">{t("uxa.open_ledger")}</Link>}
    </div>
  );
  return (
    <Section title={t("role.business")} id="request-business">
      {biz.data ? <dl>
        <KV label={t("common.name")}>{canCompany ? <Link href={`/admin/companies/${businessId}`} className="text-accent hover:underline">{name}</Link> : name}</KV>
        <KV label={t("auth.phone")}><span className="ltr-num">{biz.data.user.phone ?? "—"}</span></KV>
        <KV label={t("reg.cr")}><span className="ltr-num">{biz.data.profile?.crNumber ?? "—"}</span></KV>
      </dl> : <p className="text-sm text-muted">{hasPerm(me, "users.view") ? (biz.error ? t("uxa.load_failed") : t("uxa.loading")) : t("adm.restricted")}</p>}
      {links}
    </Section>
  );
}

/** What the business pays, what the provider is paid and the platform margin (cost and margin only for staff allowed to see pricing). */
export function FinancialsSection({ r }: { r: any }) {
  const { t, locale } = useI18n(); const s = r.pricingSnapshot;
  const money = (c: number | null | undefined) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  return (
    <Section title={t("req.cost")} id="request-financials">
      {!s ? <p className="text-sm text-muted">{t("req.no_price_yet")}</p> : (
        <dl>
          {s.unitPriceCents != null && <KV label={t("rda.unit_price")}>{money(s.unitPriceCents)}<span className="text-muted"> × {s.totalUnits ?? "—"} {t(`unit.${s.unit}`) !== `unit.${s.unit}` ? t(`unit.${s.unit}`) : ""}</span></KV>}
          <KV label={t("req.total")}><b>{money(r.totalCents)}</b></KV>
          {s.providerCostCents != null && <>
            <KV label={t("admin.provider_cost")}>{money(s.providerTotalCents)}</KV>
            <KV label={t("admin.margin")}><span className="text-gold">{money(s.marginCents)}</span></KV>
          </>}
          <KV label={t("wallet.reserved")}>{money(r.reservedCents)}</KV>
        </dl>
      )}
    </Section>
  );
}
