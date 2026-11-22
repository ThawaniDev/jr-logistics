import { defineKpis } from "./definitions";
import { kpiOf as k } from "./finance-core";

const NOT_REQUEST = ["city", "service", "vehicle", "status", "channel"] as const;
/** Wallet balances are platform-wide snapshots: no filter can narrow them. */
const ALL = ["city", "service", "vehicle", "company", "office", "driver", "status", "channel"] as const;
/** Withdrawals belong to a payee (driver or office), not to a request. */
const NO_PAYEE_REQUEST = ["city", "service", "vehicle", "company", "status", "channel"] as const;

/**
 * The KPIs of the finance report (`GET /admin/analytics/finance`, needs `reports.view` AND `finance.view`). Prices are VAT-inclusive (decision #5): the billed amount is what the
 * business pays, VAT is extracted from it, the provider cost goes to the driver or office, and the platform margin is what remains of the billed amount (it still contains the VAT, so
 * "margin after VAT" is the margin minus the VAT). Settlements, invoices and refunds are anchored to the moment they were created; withdrawals to the moment they were requested
 * (paid / rejected: decided); balances are the closing state of the last day of the period (today: live).
 */
export const FINANCE_KPI_GROUPS = {
  revenue: ["fin_billed", "fin_vat", "fin_net_sales", "fin_provider", "fin_revenue", "fin_margin_pct", "fin_net_position", "fin_aov", "fin_rev_per_request", "fin_rev_per_parcel", "fin_settlements", "fin_concentration", "fin_rental_revenue"],
  payouts: ["fin_payout_office", "fin_payout_direct", "fin_settle_latency", "fin_settle_unpaid", "fin_settle_held", "fin_wd_requested", "fin_wd_paid", "fin_wd_rejected", "fin_wd_turnaround", "fin_wd_pending"],
  wallets: ["fin_topups", "fin_wallet_liability", "fin_escrow", "fin_cash_drivers", "fin_credit_used", "fin_credit_util", "fin_invoices", "fin_invoiced", "fin_cancel_refunds", "fin_settle_refunds", "fin_adjustments"],
} as const;

defineKpis("finance", [
  k("fin_billed", "money", "higher", { money: true }), k("fin_vat", "money", "neutral", { money: true }), k("fin_net_sales", "money", "higher", { money: true }), k("fin_provider", "money", "neutral", { money: true }),
  k("fin_revenue", "money", "higher", { money: true }), k("fin_margin_pct", "percent", "higher", { money: true, ratio: true }), k("fin_net_position", "money", "higher", { money: true }),
  k("fin_aov", "money", "higher", { money: true, ratio: true }), k("fin_rev_per_request", "money", "higher", { money: true, ratio: true }), k("fin_rev_per_parcel", "money", "higher", { money: true, ratio: true }),
  k("fin_settlements", "count", "higher"), k("fin_concentration", "percent", "lower", { money: true, ratio: true }),
  k("fin_payout_office", "money", "neutral", { money: true }), k("fin_payout_direct", "money", "neutral", { money: true }),
  k("fin_settle_latency", "duration", "lower", { ratio: true }), k("fin_settle_unpaid", "count", "lower"), k("fin_settle_held", "count", "lower"),
  k("fin_wd_requested", "money", "neutral", { money: true, notFilteredBy: NO_PAYEE_REQUEST }), k("fin_wd_paid", "money", "neutral", { money: true, notFilteredBy: NO_PAYEE_REQUEST }),
  k("fin_wd_rejected", "money", "lower", { money: true, notFilteredBy: NO_PAYEE_REQUEST }), k("fin_wd_turnaround", "duration", "lower", { ratio: true, notFilteredBy: NO_PAYEE_REQUEST }),
  k("fin_wd_pending", "money", "lower", { money: true, notFilteredBy: NO_PAYEE_REQUEST }),
  k("fin_topups", "money", "higher", { money: true, notFilteredBy: [...NOT_REQUEST, "office", "driver"] }),
  k("fin_wallet_liability", "money", "neutral", { money: true, notFilteredBy: ALL }), k("fin_escrow", "money", "neutral", { money: true, notFilteredBy: ALL }),
  k("fin_cash_drivers", "money", "lower", { money: true, notFilteredBy: ALL }),
  k("fin_credit_used", "money", "lower", { money: true, notFilteredBy: [...NOT_REQUEST, "office", "driver"] }),
  k("fin_credit_util", "percent", "lower", { money: true, ratio: true, notFilteredBy: [...NOT_REQUEST, "office", "driver"] }),
  k("fin_rental_revenue", "money", "higher", { money: true, notFilteredBy: ["office", "driver"] }), // driverless rentals (no settlement): reconciles revenue with the platform wallet, see ANALYTICS.md §14
  k("fin_invoices", "count", "higher"), k("fin_invoiced", "money", "higher", { money: true }),
  k("fin_cancel_refunds", "money", "lower", { money: true }), k("fin_settle_refunds", "money", "neutral", { money: true }),
  k("fin_adjustments", "money", "neutral", { money: true, notFilteredBy: [...NOT_REQUEST, "office", "driver"] }),
]);
