"use client";
import { Section, Table, Td } from "@/components/ui";
import { EmptyState } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { RankedList } from "../RankedList";
import { fmtDur } from "../chartTheme";
import { roleHref, type SupportData } from "./support-lib";

/** Who works on the tickets and who creates them: assignee workload and speed, repeat requesters, and the companies / drivers with the most issues per order. */
export function SupportPeople({ data }: { data: SupportData }) {
  const { t, locale } = useI18n();
  const { workload, repeat, perOrder } = data;
  const dur = (v: number | null) => <span className="ltr-num tabular-nums">{v == null ? "—" : fmtDur(v, locale)}</span>;
  const n = (v: number) => <span className="ltr-num tabular-nums">{fmtNum(v, locale)}</span>;
  const per = (rows: SupportData["perOrder"]["companies"], href: (id: string) => string) => rows.map((r) => ({
    key: r.id, label: r.name, href: href(r.id), value: r.per100, tone: "gold" as const, sub: t("rpq.per_order_sub", { issues: r.issues, orders: r.orders }),
  }));
  return (
    <>
      <div data-testid="rpq-workload" className="min-w-0">
        <Section title={t("rpq.sec_workload")} description={t("rpq.sec_workload_hint")} flush>
          {workload.length === 0 ? <div className="p-4"><EmptyState title={t("rpf.no_data")} hint={t("rpq.workload_empty")} /></div> : (
            <Table bare dense stack label={t("rpq.sec_workload")} head={[t("rpq.col_assignee"), { label: t("rpq.col_assigned"), align: "end" }, { label: t("rpq.col_open_now"), align: "end" }, { label: t("rpq.col_resolved"), align: "end" }, { label: t("rpq.col_first_response"), align: "end" }, { label: t("rpq.col_resolution"), align: "end" }]}>
              {workload.map((w) => (
                <tr key={w.id}>
                  <Td label={t("rpq.col_assignee")} className="font-medium">{w.name}</Td>
                  <Td label={t("rpq.col_assigned")} align="end">{n(w.assigned)}</Td>
                  <Td label={t("rpq.col_open_now")} align="end">{n(w.open)}</Td>
                  <Td label={t("rpq.col_resolved")} align="end">{n(w.resolved)}</Td>
                  <Td label={t("rpq.col_first_response")} align="end">{dur(w.frP50)}</Td>
                  <Td label={t("rpq.col_resolution")} align="end">{dur(w.resP50)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <RankedList testId="rpq-repeat" title={t("rpq.sec_repeat")} description={t("rpq.sec_repeat_hint")} good="lower"
          rows={repeat.map((r) => ({ key: r.id, label: r.name, href: roleHref(r.role, r.id), value: r.tickets, sub: `${t(`role.${r.role}`)}${r.urgent ? ` · ${t("rpq.urgent_n", { n: r.urgent })}` : ""}` }))} />
        <RankedList testId="rpq-per-company" title={t("rpq.sec_per_company")} description={t("rpq.sec_per_order_hint", { n: perOrder.minOrders })} format="rate" good="lower" rows={per(perOrder.companies, (id) => `/admin/companies/${id}`)} />
      </div>
      <RankedList testId="rpq-per-driver" title={t("rpq.sec_per_driver")} description={t("rpq.sec_per_order_hint", { n: perOrder.minOrders })} format="rate" good="lower" rows={per(perOrder.drivers, (id) => `/admin/drivers/${id}`)} />
    </>
  );
}
