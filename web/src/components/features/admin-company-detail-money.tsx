"use client";
import { useState } from "react";
import { HandCoins, SlidersHorizontal } from "lucide-react";
import { useSWRConfig } from "swr";
import { Button, Input, Modal, Notice, ProgressBar, Section, Table, Td, errText, useAction } from "@/components/ui";
import { TrendChart, STATUS_COLOR } from "@/components/reports";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum, sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useCompany } from "./admin-companies-ctx";
import { AdjustModal } from "./admin-finance";
import { KpiTile } from "./admin-company-detail-kpis";

interface Money {
  wallet: { availableCents: number; reservedCents: number; heldCents: number; creditLimitCents: number; creditUsedCents: number; creditUse: number | null } | null;
  months: Array<{ t: string; spend: number; vat: number; topups: number }> | null;
  ledgerKinds: Array<{ kind: string; n: number; availableCents: number; reservedCents: number }> | null;
  invoices: { count: number; subtotalCents: number; vatCents: number; totalCents: number; lastAt: string | null } | null;
  moneyHidden: boolean; walletHidden: boolean;
}

/** Sets or removes the postpaid credit line (`POST /admin/finance/credit-limit`). The server refuses a limit below what the company already owes. */
function CreditLimitModal({ open, onClose, onDone, current }: { open: boolean; onClose: () => void; onDone: () => void; current: number }) {
  const { t, locale } = useI18n(); const c = useCompany(); const a = useAction();
  const [value, setValue] = useState(String(current / 100)); const [err, setErr] = useState<string | null>(null);
  const cents = sarToCents(value || 0);
  const save = () => a.run("credit", () => post("/admin/finance/credit-limit", { userId: c.id, creditLimitCents: cents }), { success: "common.saved", onDone: () => { onDone(); onClose(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <Modal open={open} onClose={onClose} busy={a.is("credit")} title={`${t("dv3.credit_title")} · ${c.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="dv3-credit-save" loading={a.is("credit")} disabled={!(cents >= 0) || cents === current} onClick={save}>{t("common.save")}</Button></>}>
      <div className="space-y-3">
        <Notice tone="info">{t("dv3.credit_hint", { current: fmtMoney(current, locale) })}</Notice>
        <Input data-testid="dv3-credit-input" label={t("dv3.credit_label")} type="number" min="0" step="0.01" ltr value={value} onChange={(e) => { setValue(e.target.value); setErr(null); }} />
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** Money tab extras: credit-line use with the adjust / credit-limit actions, 12 months of spend against top-ups, what the ledger moved by kind, and the invoice totals. */
export function CompanyMoney() {
  const { t, locale } = useI18n(); const me = useUser(); const c = useCompany(); const tx = useTx(); const { mutate } = useSWRConfig();
  const [adjust, setAdjust] = useState(false); const [credit, setCredit] = useState(false);
  const { data, error } = useApi<Money>(`/admin/companies/${c.id}/money`, { shouldRetryOnError: false });
  if (error || (data && data.walletHidden && data.moneyHidden)) return null;
  const refresh = () => void mutate((k) => typeof k === "string" && (k.startsWith("/admin/companies") || k.startsWith("/admin/finance")));
  const can = hasPerm(me, "wallet.adjust") || hasPerm(me, "refunds.manage");
  const w = data?.wallet, m = (n?: number | null) => fmtMoney(n, locale), sign = (n: number) => `${n > 0 ? "+" : ""}${m(n)}`;
  return (
    <div className="space-y-5" data-testid="dv3-money">
      <Section title={t("dv3.credit_section")} description={t("dv3.credit_sub")} actions={can && <>
        <Button size="sm" variant="secondary" data-testid="dv3-adjust-open" onClick={() => setAdjust(true)}><SlidersHorizontal className="size-4" aria-hidden />{t("adm.adjust_title")}</Button>
        <Button size="sm" variant="secondary" data-testid="dv3-credit-open" onClick={() => setCredit(true)}><HandCoins className="size-4" aria-hidden />{t("dv3.credit_title")}</Button>
      </>}>
        {w && (
          <div className="space-y-3" data-testid="dv3-credit-use">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">{w.creditLimitCents > 0 ? t("dv3.credit_used", { used: m(w.creditUsedCents), limit: m(w.creditLimitCents) }) : t("dv3.credit_none")}</p>
              {w.creditUse != null && <span className="ltr-num text-lg font-bold">{Math.round(w.creditUse * 100)}%</span>}
            </div>
            {w.creditLimitCents > 0 && <ProgressBar value={(w.creditUse ?? 0) * 100} max={100} tone={(w.creditUse ?? 0) >= 0.8 ? "gold" : "accent"} label={t("dv3.k_credit")} />}
          </div>)}
      </Section>
      {data?.invoices && (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <KpiTile id="m-inv" label={t("dv3.m_invoices")} def={t("dv3.m_d_invoices")} value={fmtNum(data.invoices.count, locale)} hint={data.invoices.lastAt ? t("dv3.m_last_invoice", { when: fmtDateTime(data.invoices.lastAt, locale) }) : undefined} />
          <KpiTile id="m-sub" label={t("adm.subtotal")} def={t("dv3.m_d_subtotal")} value={m(data.invoices.subtotalCents)} />
          <KpiTile id="m-vat" label={t("adm.vat")} def={t("dv3.m_d_vat")} value={m(data.invoices.vatCents)} />
          <KpiTile id="m-total" label={t("req.total")} def={t("dv3.m_d_total")} value={m(data.invoices.totalCents)} />
        </div>)}
      {data?.months && <TrendChart testId="dv3-chart-money" title={t("dv3.m_chart")} description={t("dv3.m_chart_hint")} data={data.months} bucket="month" format="money" height={240}
        series={[{ key: "spend", label: t("dv3.m_spend"), kind: "bar" }, { key: "topups", label: t("dv3.m_topups"), kind: "line", color: STATUS_COLOR.revenue }]} />}
      {data?.ledgerKinds && data.ledgerKinds.length > 0 && (
        <Section title={t("dv3.m_ledger")} description={t("dv3.m_ledger_hint")} flush>
          <Table bare stack dense label={t("dv3.m_ledger")} head={[t("wallet.type"), { label: t("dv3.m_entries"), align: "end" }, { label: t("dv3.m_available"), align: "end" }, { label: t("wallet.reserved"), align: "end" }]}>
            {data.ledgerKinds.map((k) => (
              <tr key={k.kind} data-testid="dv3-ledger-kind">
                <Td label={t("wallet.type")}>{tx(`ledger.${k.kind}`, k.kind)}</Td>
                <Td label={t("dv3.m_entries")} num>{fmtNum(k.n, locale)}</Td>
                <Td label={t("dv3.m_available")} num className={k.availableCents < 0 ? "text-danger" : k.availableCents > 0 ? "text-accent" : "text-muted"}>{sign(k.availableCents)}</Td>
                <Td label={t("wallet.reserved")} num className="text-muted">{sign(k.reservedCents)}</Td>
              </tr>))}
          </Table>
        </Section>)}
      <AdjustModal open={adjust} onClose={() => setAdjust(false)} onDone={refresh} account={{ id: c.id, name: c.name, role: "business" }} />
      {credit && <CreditLimitModal open onClose={() => setCredit(false)} onDone={refresh} current={w?.creditLimitCents ?? 0} />}
    </div>
  );
}
