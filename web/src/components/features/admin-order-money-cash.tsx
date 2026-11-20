"use client";
import Link from "next/link";
import { Badge, EmptyState, Pagination, Section, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";

/** Cash on delivery of the order: per driver what was due, collected, handed back and still outstanding, the remittance rows, and the refunds / manual adjustments posted for it. */
export function OrderCash({ cod, adjustments, requestId }: { cod: any; adjustments: any[]; requestId: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const m = (c: number) => fmtMoney(c, locale);
  return (
    <>
      <Section title={t("dv1.cod_title")} description={t("dv1.cod_sub")} id="order-cod" flush actions={hasPerm(me, "cod.manage") || hasPerm(me, "finance.view") ? <Link href={`/admin/finance/cod`} className="text-sm text-accent hover:underline">{t("foa.cod_open_console")}</Link> : undefined}>
        {cod.drivers.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.cod_none")} hint={t("dv1.cod_none_hint")} /></div> : (
          <>
            <Table bare stack label={t("dv1.cod_title")} head={[t("req.drivers"), { label: t("dv1.col_parcels"), align: "end" }, { label: t("dv1.cod_due"), align: "end" }, { label: t("foa.cod_collected"), align: "end" }, { label: t("foa.cod_received"), align: "end" }, { label: t("foa.cod_outstanding"), align: "end" }, t("common.status")]}>
              {cod.drivers.map((d: any) => (
                <tr key={d.offerId} data-testid="dv1-cod-row">
                  <Td label={t("req.drivers")} className="font-medium">{d.driverName}</Td><Td label={t("dv1.col_parcels")} num>{d.parcels}</Td><Td label={t("dv1.cod_due")} num>{m(d.dueCents)}</Td>
                  <Td label={t("foa.cod_collected")} num>{m(d.collectedCents)}</Td><Td label={t("foa.cod_received")} num>{m(d.receivedCents)}</Td><Td label={t("foa.cod_outstanding")} num className={d.outstandingCents > 0 ? "text-gold" : undefined}>{m(d.outstandingCents)}</Td>
                  <Td label={t("common.status")}>{d.collectedCents === 0 ? <Badge>{t("dv1.cod_none_yet")}</Badge> : d.outstandingCents > 0 ? <Badge tone="warn">{t("dv1.cod_open")}</Badge> : <Badge tone="success">{t("foa.cod_settled")}</Badge>}</Td>
                </tr>
              ))}
              <tr className="bg-bg2/50 font-semibold"><Td label="" className="text-xs uppercase text-muted">{t("dv1.cod_total")}</Td><Td label=""> </Td><Td label={t("dv1.cod_due")} num>{m(cod.totals.dueCents)}</Td><Td label={t("foa.cod_collected")} num>{m(cod.totals.collectedCents)}</Td><Td label={t("foa.cod_received")} num>{m(cod.totals.receivedCents)}</Td><Td label={t("foa.cod_outstanding")} num className={cod.totals.outstandingCents > 0 ? "text-gold" : undefined}>{m(cod.totals.outstandingCents)}</Td><Td label=""> </Td></tr>
            </Table>
            <h3 className="border-t border-line px-5 pt-4 text-sm font-semibold">{t("dv1.remit_title")}</h3>
            {cod.remittances.length === 0 ? <p className="px-5 pb-4 pt-2 text-sm text-muted">{t("foa.cod_no_remittances")}</p> : (
              <Table bare dense stack label={t("dv1.remit_title")} head={[t("dv1.col_ref"), t("req.drivers"), { label: t("common.amount"), align: "end" }, t("foa.cod_received_by"), t("foa.cod_note"), t("common.date")]}>
                {cod.remittances.map((r: any) => <tr key={r.id}><Td label={t("dv1.col_ref")} className="ltr-num">{r.ref}</Td><Td label={t("req.drivers")}>{r.driverName}</Td><Td label={t("common.amount")} num>{m(r.amountCents)}</Td><Td label={t("foa.cod_received_by")}>{r.receivedBy ?? "—"} <span className="text-xs text-muted">({tx(`role.${r.receivedByRole}`, r.receivedByRole)})</span></Td><Td label={t("foa.cod_note")} className="text-muted">{r.note ?? "—"}</Td><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td></tr>)}
              </Table>
            )}
          </>
        )}
      </Section>
      <Section title={t("dv1.adjust_title")} description={t("dv1.adjust_sub")} id="order-adjustments" flush actions={<Link href={`/admin/finance/ledger?request=${requestId}`} className="text-sm text-accent hover:underline">{t("uxa.open_ledger")}</Link>}>
        {adjustments.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.adjust_none")} /></div> : (
          <Table bare dense stack label={t("dv1.adjust_title")} head={[t("dv1.col_kind"), t("dv1.col_account"), { label: t("common.amount"), align: "end" }, t("foa.cod_note"), t("dv1.col_by"), t("common.date")]}>
            {adjustments.map((a) => <tr key={a.id}><Td label={t("dv1.col_kind")}>{tx(`ledger.${a.kind}`, a.kind)}</Td><Td label={t("dv1.col_account")}>{a.owner ?? t("dv1.platform")}</Td><Td label={t("common.amount")} num>{m(a.amountCents)}</Td><Td label={t("foa.cod_note")} className="text-muted">{a.note ?? "—"}</Td><Td label={t("dv1.col_by")}>{a.actor ?? "—"}</Td><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(a.createdAt, locale)}</Td></tr>)}
          </Table>
        )}
      </Section>
    </>
  );
}

/** Every ledger entry that references the order (paged): what moved, between whose accounts, who did it and why. */
export function OrderLedger({ ledger, page, onPage, requestId }: { ledger: any; page: number; onPage: (p: number) => void; requestId: string }) {
  const { t, locale } = useI18n(); const tx = useTx();
  const m = (c: number) => (c === 0 ? "—" : fmtMoney(c, locale));
  return (
    <Section title={t("dv1.ledger_title")} description={t("dv1.ledger_sub", { n: ledger.total })} id="order-ledger" flush actions={<Link href={`/admin/finance/ledger?request=${requestId}`} className="text-sm text-accent hover:underline" data-testid="dv1-open-ledger">{t("uxa.open_ledger")}</Link>}>
      {ledger.items.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.ledger_none")} /></div> : (
        <>
          <Table bare dense stack label={t("dv1.ledger_title")} head={[t("common.date"), t("dv1.col_kind"), t("dv1.col_account"), { label: t("dv1.col_available"), align: "end" }, { label: t("dv1.col_reserved"), align: "end" }, { label: t("dv1.col_held"), align: "end" }, t("foa.cod_note"), t("dv1.col_by")]}>
            {ledger.items.map((e: any) => (
              <tr key={e.id} data-testid="dv1-ledger-row">
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
                <Td label={t("dv1.col_kind")}>{tx(`ledger.${e.kind}`, e.kind)}{e.simulated && <Badge className="ms-1.5">{t("dv1.simulated")}</Badge>}</Td>
                <Td label={t("dv1.col_account")}>{e.owner ?? t("dv1.platform")}{e.ownerRole && <span className="text-xs text-muted"> · {tx(`role.${e.ownerRole}`, e.ownerRole)}</span>}</Td>
                <Td label={t("dv1.col_available")} num className={e.availableCents < 0 ? "text-danger" : undefined}>{m(e.availableCents)}</Td><Td label={t("dv1.col_reserved")} num>{m(e.reservedCents)}</Td><Td label={t("dv1.col_held")} num>{m(e.heldCents)}</Td>
                <Td label={t("foa.cod_note")} className="max-w-56 text-muted">{e.note ?? "—"}</Td><Td label={t("dv1.col_by")}>{e.actor ?? t("dv1.system")}</Td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-line px-5 pb-4"><Pagination page={page} total={ledger.total} pageSize={ledger.pageSize} onPage={onPage} /></div>
        </>
      )}
    </Section>
  );
}
