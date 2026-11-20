"use client";
import Link from "next/link";
import { Badge, Button, Table, Td } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import type { CodDriver, CodWarehouse } from "./business-cod";

/** Warehouse and office cells shared by the three cash tables (holders' orders, history, all orders) — J6. Test ids: `cod-col-warehouse`, `cod-col-office`. */
export function WarehouseCell({ w }: { w: CodWarehouse | undefined }) {
  const tx = useTx();
  if (!w || (!w.label && !w.city)) return <span className="text-muted" data-testid="cod-col-warehouse">—</span>;
  return (
    <span className="block min-w-0" data-testid="cod-col-warehouse">
      <span className="block max-w-[200px] truncate font-medium" title={w.label}>{w.label || "—"}</span>
      {w.city && <span className="block text-xs text-muted">{tx(`city.${w.city}`, w.city)}</span>}
    </span>
  );
}
export function OfficeCell({ officeId, officeName }: { officeId?: string | null; officeName?: string | null }) {
  const { t } = useI18n();
  if (!officeId) return <span data-testid="cod-col-office"><Badge>{t("cdc.independent")}</Badge></span>;
  return <span className="block max-w-[200px] truncate font-medium" data-testid="cod-col-office" title={officeName ?? undefined}>{officeName ?? "—"}</span>;
}

/** The orders one driver still holds cash for: Order · Warehouse · Office · Collected · Received · Outstanding · Receive. */
export function HolderOrders({ driver, onReceive }: { driver: CodDriver; onReceive: (offerId: string) => void }) {
  const { t, locale } = useI18n();
  return (
    <Table bare stack label={t("fob.cash_orders_of", { name: driver.driverName })}
      head={[t("req.ref"), t("cdc.col_warehouse"), t("cdc.col_office"), { label: t("fob.cash_collected"), align: "end" }, { label: t("fob.cash_received"), align: "end" }, { label: t("fob.cash_outstanding"), align: "end" }, { label: t("common.open"), srOnly: true }]}>
      {driver.orders.map((o) => (
        <tr key={o.offerId} data-testid="cod-order" data-offer={o.offerId}>
          <Td label={t("req.ref")}><Link href={`/business/requests/${o.requestId}/money`} className="ltr-num whitespace-nowrap font-semibold text-accent hover:underline">{o.ref}</Link></Td>
          <Td label={t("cdc.col_warehouse")}><WarehouseCell w={o.warehouse} /></Td>
          <Td label={t("cdc.col_office")}><OfficeCell officeId={o.officeId} officeName={o.officeName} /></Td>
          <Td label={t("fob.cash_collected")} num>{fmtMoney(o.collectedCents, locale)}</Td>
          <Td label={t("fob.cash_received")} num className="text-muted">{fmtMoney(o.receivedCents, locale)}</Td>
          <Td label={t("fob.cash_outstanding")} num className={cn("font-semibold", o.outstandingCents > 0 && "text-gold")}>{fmtMoney(o.outstandingCents, locale)}</Td>
          <Td align="end"><Button size="sm" variant="secondary" onClick={() => onReceive(o.offerId)} data-testid="cod-order-receive" className="whitespace-nowrap">{t("fob.rcv_short")}</Button></Td>
        </tr>
      ))}
    </Table>
  );
}
