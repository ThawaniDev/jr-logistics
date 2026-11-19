"use client";
import { useState } from "react";
import { HandCoins } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, Pagination, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { qs } from "./admin-common";
import { ListBody, Money, PAGE, partyHref } from "./admin-finance-parts";
import type { CodRow } from "./admin-fieldops-lib";

/** Orders with cash: one row per order, "Receive money" at the end of the rows that still have an amount outstanding. */
export function OrdersTable({ rows, focusOffer, canManage, onReceive, page, total, onPage }: { rows: CodRow[]; focusOffer: string; canManage: boolean; onReceive: (r: CodRow) => void; page: number; total: number; onPage: (p: number) => void }) {
  const { t, locale } = useI18n();
  return (
    <>
      <Table stack label={t("foa.cod_tab_orders")} head={[t("foa.cod_warehouse"), t("foa.cod_driver"), t("foa.cod_order"), { label: t("foa.cod_collected"), align: "end" }, { label: t("foa.cod_received"), align: "end" }, { label: t("foa.cod_outstanding"), align: "end" }, { label: t("rdf.actions"), srOnly: true }]}>
        {rows.map((x: CodRow & { lastCollectedAt?: string | null }) => (
          <tr key={x.offerId} data-testid={`foa-cod-row-${x.offerId}`} className={x.offerId === focusOffer ? "bg-accent/5" : undefined}>
            <Td label={t("foa.cod_warehouse")}><CellPair href={partyHref("business", x.businessId)} title={x.businessName} /></Td>
            <Td label={t("foa.cod_driver")}><CellPair href={partyHref("driver", x.driverId)} title={x.driverName} /></Td>
            <Td label={t("foa.cod_order")}><CellPair href={x.requestId ? `/admin/requests/${x.requestId}` : undefined} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={x.lastCollectedAt ? <span className="whitespace-nowrap">{fmtDateTime(x.lastCollectedAt, locale)}</span> : undefined} /></Td>
            <Td label={t("foa.cod_collected")} num><Money c={x.collectedCents} /></Td>
            <Td label={t("foa.cod_received")} num><Money c={x.receivedCents} /></Td>
            <Td label={t("foa.cod_outstanding")} num>{x.outstandingCents > 0 ? <span className="font-semibold text-gold"><Money c={x.outstandingCents} /></span> : <Badge tone="success">{t("foa.cod_settled")}</Badge>}</Td>
            <Td>{canManage && x.outstandingCents > 0 && <Button size="sm" data-testid={`foa-cod-receive-${x.offerId}`} onClick={() => onReceive(x)}>{t("foa.cod_receive_row")}</Button>}</Td>
          </tr>))}
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE} onPage={onPage} />
    </>
  );
}

interface DriverRow { driverId: string; driverName: string; orders: number; openOrders: number; collectedCents: number; receivedCents: number; outstandingCents: number; lastCollectedAt: string | null }
/** Cash by driver: who holds how much. "View orders" jumps to that driver's orders (where the money is received, order by order). */
export function DriversTable({ rows, onOpen }: { rows: DriverRow[]; onOpen: (driverId: string) => void }) {
  const { t, locale } = useI18n(); const [page, setPage] = useState(1);
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  return (
    <>
      <Table stack label={t("rdf.cod_by_driver")} head={[t("foa.cod_driver"), { label: t("rdf.cod_orders_owing"), align: "end" }, { label: t("foa.cod_collected"), align: "end" }, { label: t("foa.cod_received"), align: "end" }, { label: t("foa.cod_outstanding"), align: "end" }, t("rdf.cod_last_collected"), { label: t("rdf.actions"), srOnly: true }]}>
        {slice.map((d) => (
          <tr key={d.driverId} data-testid={`fin-cod-driver-${d.driverId}`}>
            <Td label={t("foa.cod_driver")}><CellPair href={partyHref("driver", d.driverId)} title={d.driverName} /></Td>
            <Td label={t("rdf.cod_orders_owing")} num>{d.openOrders} <span className="text-xs text-muted">/ {d.orders}</span></Td>
            <Td label={t("foa.cod_collected")} num><Money c={d.collectedCents} /></Td>
            <Td label={t("foa.cod_received")} num><Money c={d.receivedCents} /></Td>
            <Td label={t("foa.cod_outstanding")} num>{d.outstandingCents > 0 ? <span className="font-semibold text-gold"><Money c={d.outstandingCents} /></span> : <Badge tone="success">{t("foa.cod_settled")}</Badge>}</Td>
            <Td label={t("rdf.cod_last_collected")} className="whitespace-nowrap text-muted">{d.lastCollectedAt ? fmtDateTime(d.lastCollectedAt, locale) : "—"}</Td>
            <Td><Button size="sm" variant="secondary" data-testid={`fin-cod-driver-orders-${d.driverId}`} onClick={() => onOpen(d.driverId)}>{t("rdf.cod_view_orders")}</Button></Td>
          </tr>))}
      </Table>
      <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} />
    </>
  );
}

/** Every receipt recorded (by a warehouse or by staff), newest first. */
export function RemittancesTable({ businessId, driverId, enabled }: { businessId: string; driverId: string; enabled: boolean }) {
  const { t, locale } = useI18n(); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(enabled ? `/admin/cod/remittances${qs({ businessId, driverId, page })}` : null, { keepPreviousData: true });
  return (
    <ListBody error={error} loaded={!!data} isEmpty={data?.items.length === 0} retry={() => mutate()}
      emptyState={<EmptyState icon={<HandCoins className="size-9" aria-hidden />} title={t("foa.cod_no_remittances")} hint={t("rdf.cod_no_remittances_hint")} />}>
      <Table stack label={t("foa.cod_tab_remittances")} head={[t("common.date"), t("foa.cod_order"), t("foa.cod_warehouse"), t("foa.cod_driver"), { label: t("common.amount"), align: "end" }, t("foa.cod_received_by"), t("foa.cod_note")]}>
        {data?.items.map((x: any) => (
          <tr key={x.id} data-testid={`foa-cod-remittance-${x.id}`}>
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(x.createdAt, locale)}</Td>
            <Td label={t("foa.cod_order")}><CellPair href={x.requestId ? `/admin/requests/${x.requestId}` : undefined} title={<span className="ltr-num font-semibold">{x.orderRef ?? x.ref ?? "—"}</span>} sub={x.orderRef && x.ref ? <span className="ltr-num">{x.ref}</span> : undefined} /></Td>
            <Td label={t("foa.cod_warehouse")}>{x.businessName ? <CellPair href={partyHref("business", x.businessId)} title={x.businessName} /> : "—"}</Td>
            <Td label={t("foa.cod_driver")}>{x.driverName ? <CellPair href={partyHref("driver", x.driverId)} title={x.driverName} /> : "—"}</Td>
            <Td label={t("common.amount")} num className="font-semibold"><Money c={x.amountCents} /></Td>
            <Td label={t("foa.cod_received_by")}><CellPair title={x.receivedByName ?? "—"} sub={x.receivedByRole ? (t(`role.${x.receivedByRole}`) === `role.${x.receivedByRole}` ? x.receivedByRole : t(`role.${x.receivedByRole}`)) : undefined} /></Td>
            <Td label={t("foa.cod_note")} className="max-w-56 text-xs text-muted">{x.note ?? "—"}</Td>
          </tr>))}
      </Table>
      <Pagination page={page} total={data?.total ?? 0} pageSize={data?.pageSize ?? 25} onPage={setPage} />
    </ListBody>
  );
}
