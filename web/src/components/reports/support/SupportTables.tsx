"use client";
import { useState } from "react";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { DrillTable } from "../DrillTable";

interface View { key: string; label: string; noPeriod?: boolean }
const TICKET_VIEWS: View[] = [
  { key: "tickets", label: "rpq.view_all" }, { key: "tickets-open", label: "rpq.view_open", noPeriod: true }, { key: "tickets-breached", label: "rpq.view_breached" },
  { key: "tickets-at-risk", label: "rpq.view_at_risk", noPeriod: true }, { key: "tickets-urgent", label: "rpq.view_urgent" }, { key: "tickets-reopened", label: "rpq.view_reopened" },
];
const COMPLAINT_VIEWS: View[] = [{ key: "complaints", label: "rpq.view_all" }, { key: "complaints-open", label: "rpq.view_open", noPeriod: true }, { key: "complaints-holding", label: "rpq.view_holding", noPeriod: true }];
const RATING_VIEWS: View[] = [{ key: "low-ratings", label: "rpq.view_low" }, { key: "ratings", label: "rpq.view_all" }];

/** One drill-down table with a segmented switch between its registered views (all / open / breached …); views that ignore the period say so. */
function Switcher({ testId, label, views, qs }: { testId: string; label: string; views: View[]; qs: string }) {
  const { t } = useI18n();
  const [view, setView] = useState(views[0].key);
  const cur = views.find((v) => v.key === view) ?? views[0];
  return (
    <section data-testid={testId} aria-label={label} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-semibold">{label}</h2>
        <Segmented label={label} value={view} onChange={setView} options={views.map((v) => ({ key: v.key, label: t(v.label) }))} />
        {cur.noPeriod && <p className="text-xs text-muted" data-testid={`${testId}-noperiod`}>{t("rpq.view_ignores_period")}</p>}
      </div>
      <DrillTable testId={`${testId}-table`} report="support" name={cur.key} qs={qs} />
    </section>
  );
}

/** The drill-down tables of the Support report: tickets, complaints and ratings, each filterable by state, sortable, paged and exportable (CSV for `reports.export`). */
export function SupportTables({ qs }: { qs: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <Switcher testId="rpq-tickets" label={t("rpq.tbl_tickets_title")} views={TICKET_VIEWS} qs={qs} />
      <Switcher testId="rpq-complaints" label={t("rpq.tbl_complaints_title")} views={COMPLAINT_VIEWS} qs={qs} />
      <Switcher testId="rpq-ratings" label={t("rpq.tbl_ratings_title")} views={RATING_VIEWS} qs={qs} />
    </div>
  );
}
