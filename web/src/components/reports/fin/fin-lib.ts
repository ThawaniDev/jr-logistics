import { createElement, type ReactNode } from "react";
import type { Locale } from "@/i18n/core";
import type { BarRow } from "../BarRows";
import { fmtDur, fmtPercent, formatValue, seriesColor, STATUS_COLOR } from "../chartTheme";
import type { Slice } from "../DonutChart";
import type { HistogramBucket } from "../HistogramChart";
import type { TrendPoint } from "../TrendChart";
import type { Kpi } from "../types";
import { OTHERS } from "@/server/analytics/deliveries-keys";
import type { CityName, DeliveriesData, FinanceData, GroupRow, Holder, MarginRow, T } from "./types";

/** Pure helpers that turn the deliveries / COD / finance responses into component props (unit-tested; no React). */

/** The KPIs of one group, in the order of `keys` (a KPI the viewer may not see is simply absent). */
export const kpiPick = (kpis: Kpi[], keys: readonly string[]): Kpi[] => keys.map((k) => kpis.find((x) => x.key === k)).filter((x): x is Kpi => !!x);
/** Success rate of a delivery group: delivered ÷ resolved; null with nothing resolved. */
export const successOf = (g: Pick<GroupRow, "delivered" | "resolved">): number | null => (g.resolved > 0 ? g.delivered / g.resolved : null);

/** The label of a group: the translated city / service / vehicle, the name of a company / office / driver, "Not specified" for an empty key. */
export function groupLabel(g: Pick<GroupRow, "dim" | "key" | "name">, t: T, cityName?: CityName): string {
  if (g.name) return g.name;
  if (!g.key) return t("rpf.not_specified");
  const ns = g.dim === "city" ? "city." : g.dim === "service" ? "svc." : g.dim === "vehicle" ? "vehicle." : "";
  if (!ns) return `${g.key.slice(0, 8)}…`;
  const k = `${ns}${g.key}`, s = t(k);
  return s !== k ? s : (g.dim === "city" ? cityName?.(g.key) : undefined) ?? g.key;
}
const GROUP_HREF: Partial<Record<GroupRow["dim"], string>> = { company: "/admin/companies/", office: "/admin/offices/", driver: "/admin/drivers/" };
const hrefOf = (g: Pick<GroupRow, "dim" | "key">) => (GROUP_HREF[g.dim] ? `${GROUP_HREF[g.dim]}${g.key}` : undefined);

/** Rows of a breakdown of the resolved parcels: bar = resolved parcels, sub-line = delivered / failed / success rate, change against the previous period. */
export function groupRows(rows: GroupRow[], t: T, locale: Locale, cityName?: CityName): BarRow[] {
  const total = rows.reduce((s, r) => s + r.resolved, 0);
  return rows.map((g) => {
    const s = successOf(g);
    return {
      key: `${g.dim}:${g.key}`, label: groupLabel(g, t, cityName), value: g.resolved, prev: g.prevResolved, share: total > 0 ? g.resolved / total : null, href: hrefOf(g),
      sub: wrapSub(t("rpd.grp_sub", { delivered: formatValue(g.delivered, "number", locale), failed: formatValue(g.failed, "number", locale), rate: s == null ? "—" : fmtPercent(s, locale) })),
    };
  });
}
/** The weakest groups by success rate (a bar per group scaled to 100%); `volume` is shown so a rate is never read without its sample. */
export function worstRows(rows: GroupRow[], t: T, locale: Locale, cityName?: CityName): BarRow[] {
  return rows.map((g) => ({
    key: `${g.dim}:${g.key}`, label: groupLabel(g, t, cityName), value: successOf(g), href: hrefOf(g), tone: "danger" as const,
    sub: wrapSub(t("rpd.worst_sub", { n: formatValue(g.resolved, "number", locale), failed: formatValue(g.failed, "number", locale) })),
  }));
}

/** The translated failure reason; an unknown reason is shown as it is stored. */
export function reasonLabel(reason: string, t: T): string {
  if (reason === OTHERS) return t("rpd.reason_others");
  const k = `stopfail.${reason}`, s = t(k);
  return s !== k ? s : reason;
}
export const reasonSlices = (all: DeliveriesData["reasons"]["all"], t: T): Slice[] => all.filter((r) => r.n > 0).map((r) => ({ key: r.reason, label: reasonLabel(r.reason, t), value: r.n }));
export const reasonRows = (all: DeliveriesData["reasons"]["all"], t: T): BarRow[] => all.map((r) => ({ key: r.reason, label: reasonLabel(r.reason, t), value: r.n, prev: r.prev, share: null }));

/** A sub-line that may wrap: the bar rows truncate their sub-line to one line, which cuts a long figure-laden line (especially in Arabic) on a phone. */
export const wrapSub = (s: string): ReactNode => createElement("span", { className: "whitespace-normal" }, s);

/** The cells of the reasons matrix: one row per city / company, one column per top reason plus "others" (counts, with the row total). */
export function matrixColumns(top: string[], rows: Array<{ by: Record<string, number> }>): string[] {
  return rows.some((r) => (r.by[OTHERS] ?? 0) > 0) ? [...top, OTHERS] : top;
}

type Hist = Array<{ from: number | null; to: number | null; count: number }>;
/** Labels for a histogram: durations (seconds), distances (metres) or plain counts (attempts: 0, 1, 2, 3+). */
export function histBuckets(h: Hist, kind: "duration" | "distance" | "attempts", t: T, locale: Locale): HistogramBucket[] {
  return h.map((b) => {
    const count = b.count;
    if (kind === "attempts") return { count, label: b.to == null ? t("rpd.attempts_n_plus", { n: formatValue(b.from ?? 0, "number", locale) }) : formatValue(b.from ?? 0, "number", locale) };
    const f = (v: number) => (kind === "duration" ? fmtDur(v, locale) : t("rpd.metres", { n: formatValue(v, "number", locale) }));
    return { count, label: b.from == null ? t("rpf.hist_lt", { to: f(b.to!) }) : b.to == null ? t("rpf.hist_gte", { from: f(b.from) }) : t("rpf.hist_range", { from: f(b.from), to: f(b.to) }) };
  });
}

/** Delivery success per bucket (delivered ÷ resolved) from the outcome series; a bucket with nothing resolved is a gap. */
export function successSeries(points: DeliveriesData["series"]["outcomes"]["points"], prev: DeliveriesData["series"]["outcomes"]["prev"]): { data: TrendPoint[]; prev: TrendPoint[] | null } {
  const one = (p: { t: string; delivered: number; failed: number; returned: number }): TrendPoint => { const d = p.delivered + p.failed + p.returned; return { t: p.t, success: d > 0 ? p.delivered / d : null }; };
  return { data: points.map(one), prev: prev ? prev.map(one) : null };
}
export const PROOF_KEYS = ["otp", "receipt", "scan"] as const;
/** Proof of delivery mix: delivery code, receipt photo, scan only (a signature is counted on top of these, not instead). */
export const proofSlices = (p: DeliveriesData["proof"], t: T): Slice[] => PROOF_KEYS.map((k) => ({ key: k, label: t(`rpd.proof.${k}`), value: p[k] }));
export const DEFER_KEYS = ["both", "note", "photo", "none"] as const;
export const deferSlices = (e: DeliveriesData["defer"]["evidence"], t: T): Slice[] => DEFER_KEYS.map((k, i) => ({ key: k, label: t(`rpd.defer.${k}`), value: e[k], color: seriesColor(k === "none" ? 3 : i) }));
export const OUTCOME_COLORS = STATUS_COLOR;

/** Series definitions (key, label, colour) of the flow chart. */
export const FLOW_SERIES = ["created", "handed", "delivered", "failed"] as const;
export const flowSeries = (t: T) => FLOW_SERIES.map((k, i) => ({ key: k, label: t(`rpd.s_${k}`), kind: "line" as const, color: k === "delivered" ? STATUS_COLOR.delivered : k === "failed" ? STATUS_COLOR.failed : seriesColor(i === 0 ? 4 : 1) }));

// ───────── COD ─────────
/** Rows of the aging chart: orders per age bucket (the amount as the sub-line for finance viewers); old cash is drawn in the warning colours. */
export function ageRows(buckets: Array<{ key: string; orders: number; cents?: number }>, t: T, locale: Locale): BarRow[] {
  const total = buckets.reduce((s, b) => s + b.orders, 0);
  return buckets.map((b, i) => ({
    key: b.key, label: t(`rpd.age.${b.key}`), value: b.orders, share: total > 0 ? b.orders / total : null, tone: i >= 3 ? ("danger" as const) : i === 2 ? ("gold" as const) : ("accent" as const),
    sub: b.cents != null ? formatValue(b.cents, "money", locale) : undefined,
  }));
}
export const holderRows = (list: Holder[], hrefBase: string, locale: Locale, t: T): BarRow[] => list.map((h) => ({
  key: h.key, label: h.name ?? `${h.key.slice(0, 8)}…`, value: h.outstanding, href: `${hrefBase}${h.key}`, tone: h.oldestDays >= 8 ? ("danger" as const) : undefined,
  sub: wrapSub(t("rpd.holder_sub", { orders: formatValue(h.orders, "number", locale), age: formatValue(Math.floor(h.oldestDays), "number", locale) })),
}));

// ───────── Finance ─────────
export const SERVICE_SERIES = (services: readonly string[], t: T) => services.map((s, i) => ({ key: `s_${s}`, label: t(`svc.${s}`), color: seriesColor(i === 0 ? 0 : i === 1 ? 4 : 1) }));
/** Margin percentage of every row of a margin table; null when nothing was billed. */
export const marginPct = (r: Pick<MarginRow, "billed" | "margin">): number | null => (r.billed > 0 ? r.margin / r.billed : null);
export function marginLabel(r: Pick<MarginRow, "dim" | "key">, t: T, cityName?: CityName): string {
  if (!r.key) return t("rpf.not_specified");
  const ns = r.dim === "city" ? "city." : r.dim === "service" ? "svc." : "vehicle.";
  const s = t(`${ns}${r.key}`);
  return s !== `${ns}${r.key}` ? s : (r.dim === "city" ? cityName?.(r.key) : undefined) ?? r.key;
}
/** Rows of the pipeline aging chart (unpaid settlements by age); held ones are the sub-line. */
export const pipelineRows = (b: FinanceData["pipeline"]["buckets"], t: T, locale: Locale): BarRow[] => {
  const total = b.reduce((s, x) => s + x.n, 0);
  return b.map((x, i) => ({ key: x.key, label: t(`rpd.age.${x.key}`), value: x.n, share: total > 0 ? x.n / total : null, tone: i >= 3 ? ("danger" as const) : i === 2 ? ("gold" as const) : ("accent" as const),
    sub: wrapSub(t("rpd.pipe_sub", { payout: formatValue(x.payoutCents, "money", locale), held: formatValue(x.heldN, "number", locale) })) }));
};
export const waterfallBars = (steps: FinanceData["waterfall"]["cur"], t: T) => {
  let run = 0;
  return steps.map((s) => {
    const start = s.total ? 0 : run, end = s.total ? s.value : run + s.value;
    run = end;
    return { key: s.key, label: t(`rpd.wf_${s.key}`), low: Math.min(start, end), high: Math.max(start, end), value: s.value, total: s.total };
  });
};

/** Rows of a margin breakdown: the billed amount (bar, change against the previous period) with the margin and its percentage as the sub-line. */
export function marginRows(rows: MarginRow[], t: T, locale: Locale, cityName?: CityName): BarRow[] {
  const total = rows.reduce((s, r) => s + r.billed, 0);
  return rows.map((r) => {
    const p = marginPct(r);
    return {
      key: `${r.dim}:${r.key}`, label: marginLabel(r, t, cityName), value: r.billed, prev: r.prevBilled, share: total > 0 ? r.billed / total : null,
      sub: wrapSub(t("rpd.margin_sub", { margin: formatValue(r.margin, "money", locale), pct: p == null ? "—" : fmtPercent(p, locale), vat: formatValue(r.vat, "money", locale) })),
    };
  });
}
/** Margin percentage per bucket (margin ÷ billed); a bucket without billing is a gap. */
type MoneyPoint = { t: string; billed?: number; margin?: number };
export function marginPctSeries(points: MoneyPoint[], prev: MoneyPoint[] | null): { data: TrendPoint[]; prev: TrendPoint[] | null } {
  const one = (p: MoneyPoint): TrendPoint => ({ t: p.t, pct: (p.billed ?? 0) > 0 ? (p.margin ?? 0) / p.billed! : null });
  return { data: points.map(one), prev: prev ? prev.map(one) : null };
}
/** Withdrawals by their current status: the amount (bar) and the number of requests. */
export const withdrawalRows = (rows: FinanceData["withdrawals"]["byStatus"], t: T, locale: Locale): BarRow[] => {
  const order = ["pending", "approved", "paid", "rejected"];
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return [...rows].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((r) => ({
    key: r.key, label: t(`wdstatus.${r.key}`), value: r.cents, share: total > 0 ? r.cents / total : null, tone: r.key === "rejected" ? ("danger" as const) : r.key === "paid" ? ("accent" as const) : ("gold" as const),
    sub: t("rpd.wd_sub", { n: formatValue(r.n, "number", locale) }),
  }));
};
/** The companies that use the largest part of their credit limit (bar = share of the limit). */
export const creditRows = (rows: FinanceData["credit"]["top"], t: T, locale: Locale): BarRow[] => rows.map((c) => ({
  key: c.id, label: c.name ?? `${c.id.slice(0, 8)}…`, value: c.util, href: `/admin/companies/${c.id}`, tone: c.util != null && c.util >= 0.8 ? ("danger" as const) : undefined,
  sub: wrapSub(t("rpd.credit_sub", { used: formatValue(c.used, "money", locale), limit: formatValue(c.limit, "money", locale) })),
}));
export const topCompanyRows = (rows: FinanceData["companies"]["top"], t: T, locale: Locale): BarRow[] => {
  const total = rows.reduce((s, r) => s + r.billed, 0);
  return rows.map((c) => ({
    key: c.id, label: c.name ?? `${c.id.slice(0, 8)}…`, value: c.billed, prev: c.prevBilled, share: total > 0 ? c.billed / total : null, href: `/admin/companies/${c.id}`,
    sub: wrapSub(t("rpd.margin_sub", { margin: formatValue(c.margin, "money", locale), pct: c.billed > 0 ? fmtPercent(c.margin / c.billed, locale) : "—", vat: formatValue(c.vat, "money", locale) })),
  }));
};
export const outlierRows = (rows: FinanceData["companies"]["outliers"]["low"], t: T, locale: Locale): BarRow[] => rows.map((c) => ({
  key: c.id, label: c.name ?? `${c.id.slice(0, 8)}…`, value: c.pct, href: `/admin/companies/${c.id}`, tone: c.diff < 0 ? ("danger" as const) : ("accent" as const),
  sub: wrapSub(t("rpd.outlier_sub", { billed: formatValue(c.billed, "money", locale), diff: `${c.diff > 0 ? "+" : "−"}${formatValue(Math.abs(c.diff) * 100, "number", locale)}` })),
}));
/** Money returned to businesses and manual wallet changes in the period. */
export const refundRows = (r: FinanceData["refunds"], t: T): BarRow[] => [
  { key: "cancel", label: t("rpd.ref_cancel"), value: r.cancelCents, sub: t("rpd.ref_cancel_n", { n: r.cancelN }) }, { key: "settlement", label: t("rpd.ref_settlement"), value: r.settlementCents },
  { key: "adj_in", label: t("rpd.ref_adj_in"), value: r.adjustmentsIn, tone: "accent" as const }, { key: "adj_out", label: t("rpd.ref_adj_out"), value: r.adjustmentsOut, tone: "danger" as const },
];
export const BALANCE_SERIES = ["liability", "escrow", "cash", "credit"] as const;
