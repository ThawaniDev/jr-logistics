/** Pure helpers of the order and parcel views (no React, no I/O): tabs, KPI cards, manifest filters, journey titles. Unit-tested in tests/unit/orders-ui-lib.test.ts. */
import type { Locale } from "@/i18n/core";
import { fmtDuration, fmtMoney, fmtNum } from "@/lib/format";

type Can = (perm: string) => boolean;
type TFn = (k: string, v?: Record<string, string | number>) => string;

// ───────── Tabs ─────────
export const ORDER_TABS = ["overview", "drivers", "parcels", "money", "communication", "activity"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];
/** The sections a staff member can open (the order itself needs `requests.view`; money needs `finance.view`; parcels exist only for delivery orders). */
export function orderTabs(can: Can, manifest: boolean): OrderTab[] {
  return ORDER_TABS.filter((t) => (t === "money" ? can("finance.view") : t === "parcels" ? manifest : true));
}
export const orderTabHref = (id: string, tab: OrderTab) => `/admin/requests/${id}${tab === "overview" ? "" : `/${tab}`}`;

// ───────── Manifest filters ─────────
export interface ParcelFilters { status: string; offerId: string; city: string; q: string; cod: boolean; incomplete: boolean; page: number }
export const NO_PARCEL_FILTERS: ParcelFilters = { status: "", offerId: "", city: "", q: "", cod: false, incomplete: false, page: 1 };
export const parcelFiltersActive = (f: ParcelFilters) => !!(f.status || f.offerId || f.city || f.q.trim() || f.cod || f.incomplete);
/** The query string of GET /admin/requests/:id/parcels (empty values are dropped, so the URL and the cache key stay clean). */
export function parcelQuery(f: ParcelFilters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.offerId) p.set("offerId", f.offerId);
  if (f.city) p.set("city", f.city);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.cod) p.set("cod", "1");
  if (f.incomplete) p.set("incomplete", "1");
  if (f.page > 1) p.set("page", String(f.page));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ───────── KPI strip ─────────
export interface KpiCard { key: string; value: string; hint?: string; tone: "accent" | "cyan" | "gold" | "muted" | "danger" }
const pct = (f: number | null, l: Locale) => (f == null ? "—" : `${fmtNum(Math.round(f * 1000) / 10, l)}%`);
const dur = (s: number | null, l: Locale) => (s == null ? "—" : s < 60 ? `${fmtNum(Math.round(s), l)} ${l === "en" ? "s" : l === "ur" ? "سیکنڈ" : "ث"}` : fmtDuration(s, l));

/** The KPI cards of an order, from the overview payload. Money / cash cards exist only when the payload carries them (the server omits what the viewer may not see). */
export function kpiCards(k: any, l: Locale, t: TFn): KpiCard[] {
  const out: KpiCard[] = [];
  const p = k.parcels, s = k.start;
  const open = k.slots.needed - k.slots.filled;
  out.push({ key: "slots", value: `${fmtNum(k.slots.filled, l)}/${fmtNum(k.slots.needed, l)}`, hint: open > 0 ? t("dv1.hint_slots_open", { n: open }) : t("dv1.hint_slots_full"), tone: open > 0 ? "gold" : "accent" });
  if (p.total > 0) {
    out.push({ key: "parcels", value: fmtNum(p.total, l), hint: t("dv1.hint_parcels", { delivered: p.delivered, failed: p.failed, returned: p.returned, pending: p.pending }), tone: "cyan" });
    out.push({ key: "success", value: pct(k.successRate, l), hint: k.successRate == null ? t("dv1.hint_no_outcomes") : t("dv1.hint_success", { n: p.delivered, d: p.delivered + p.failed + p.returned }), tone: k.successRate == null ? "muted" : k.successRate >= 0.9 ? "accent" : k.successRate >= 0.7 ? "gold" : "danger" });
    out.push({ key: "first_attempt", value: pct(k.firstAttemptRate, l), hint: k.firstAttemptRate == null ? t("dv1.hint_no_deliveries") : undefined, tone: "muted" });
  }
  out.push({ key: "start", value: lateText(s.deltaMin, t, l), hint: s.arrived === 0 ? t("dv1.hint_no_arrivals") : t("dv1.hint_start", { late: s.late, n: s.arrived }), tone: s.arrived === 0 ? "muted" : s.late > 0 ? "danger" : "accent" });
  out.push({ key: "first_offer", value: dur(k.timeToFirstOfferS, l), tone: "muted" });
  out.push({ key: "fill", value: dur(k.timeToFillS, l), hint: k.timeToFirstAcceptS == null ? undefined : t("dv1.hint_first_accept", { time: dur(k.timeToFirstAcceptS, l) }), tone: "muted" });
  out.push({ key: "execution", value: dur(k.executionS, l), hint: k.executionRunning ? t("dv1.hint_running") : undefined, tone: k.executionRunning ? "cyan" : "muted" });
  if (k.money) {
    const m = k.money;
    out.push({ key: "price", value: fmtMoney(m.totalCents, l), hint: m.reservedCents > 0 ? t("dv1.hint_reserved", { amount: fmtMoney(m.reservedCents, l) }) : undefined, tone: "accent" });
    if (m.providerCents != null) out.push({ key: "provider", value: fmtMoney(m.providerCents, l), tone: "muted" });
    if (m.marginCents != null) out.push({ key: "margin", value: fmtMoney(m.marginCents, l), hint: m.totalCents ? t("dv1.hint_margin", { pct: fmtNum(Math.round((m.marginCents / m.totalCents) * 1000) / 10, l) }) : undefined, tone: "gold" });
  }
  if (k.cod && k.cod.dueCents > 0) {
    out.push({ key: "cod_due", value: fmtMoney(k.cod.dueCents, l), tone: "muted" });
    out.push({ key: "cod_collected", value: fmtMoney(k.cod.collectedCents, l), hint: k.cod.remittedCents > 0 ? t("dv1.hint_remitted", { amount: fmtMoney(k.cod.remittedCents, l) }) : undefined, tone: "cyan" });
    out.push({ key: "cod_outstanding", value: fmtMoney(k.cod.outstandingCents, l), tone: k.cod.outstandingCents > 0 ? "gold" : "accent" });
  }
  out.push({ key: "rating", value: k.rating.avg == null ? "—" : `${fmtNum(Math.round(k.rating.avg * 10) / 10, l)} ★`, hint: k.rating.count ? t("dv1.hint_ratings", { n: k.rating.count }) : t("dv1.hint_not_rated"), tone: "gold" });
  if (k.support) out.push({ key: "support", value: fmtNum(k.support.open, l), hint: t("dv1.hint_support", { n: k.support.total }), tone: k.support.open > 0 ? "danger" : "muted" });
  return out;
}

// ───────── Parcel journey ─────────
/** Params of a `dtk.p_<type>` title from a journey event (reason / why are translated when a wording exists, otherwise shown as written). */
export function journeyParams(e: { type: string; payload?: any }, code: string, t: TFn, l: Locale): Record<string, string | number> {
  const p = e.payload ?? {};
  const tr = (v: unknown) => { if (typeof v !== "string" || !v) return "—"; const k = t(`stopfail.${v}`); return k.startsWith("stopfail.") ? v.replace(/_/g, " ") : k; };
  return { code: typeof p.code === "string" && p.code ? p.code : code, reason: tr(p.reason), why: tr(p.why), stopOrder: typeof p.stopOrder === "number" ? p.stopOrder : "—", amount: typeof p.amountCents === "number" ? fmtMoney(p.amountCents, l) : "—" };
}
/** Short facts of an event under its title (distance, note, proof type …). */
export function journeyFacts(e: { type: string; payload?: any }, t: TFn, l: Locale): string[] {
  const p = e.payload ?? {}; const out: string[] = [];
  if (typeof p.note === "string" && p.note) out.push(`“${p.note}”`);
  if (p.proofType === "otp" || p.proofType === "receipt" || p.proofType === "scan") out.push(t(p.proofType === "otp" ? "shipadm.ev_proof_otp" : p.proofType === "receipt" ? "shipadm.ev_proof_receipt" : "fob.proof_scan"));
  if (typeof p.distanceM === "number") out.push(t("shipadm.ev_distance", { n: Math.round(p.distanceM) }));
  if (p.via === "scan" || p.via === "warehouse") out.push(t(p.via === "scan" ? "dv1.via_scan" : "dv1.via_warehouse"));
  if (typeof p.legDistanceM === "number") out.push(t("dv1.leg_km", { n: fmtNum(Math.round(p.legDistanceM / 100) / 10, l) }));
  if (p.auto === true) out.push(t("fo.ev_auto"));
  if (p.backfill === true) out.push(t("dv1.backfilled"));
  return out;
}

/** "12 min late" / "3 h early" / "on time" from signed minutes (positive = late). */
export const lateText = (min: number | null, t: TFn, l: Locale): string => (min == null ? "—" : min === 0 ? t("dv1.on_time") : t(min > 0 ? "dv1.late_by" : "dv1.early_by", { n: fmtDuration(Math.abs(min) * 60, l) }));
