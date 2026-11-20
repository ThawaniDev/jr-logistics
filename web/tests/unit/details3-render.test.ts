import { describe, it, expect } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/components/layout/auth-context";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";
import { CompanyKpiStrip, KpiTile, type CompanyStats } from "@/components/features/admin-company-detail-kpis";
import { CompanyAlerts, CompanyHealth } from "@/components/features/admin-company-detail-charts";
import { SlaClocks } from "@/components/features/admin-ticket-sla";
import { PersonCardView, RelatedCardsView, type PersonCard, type Related } from "@/components/features/admin-ticket-cards";
import { HandlingHistory, OutcomeStats, SimilarCases } from "@/components/features/admin-ticket-history";
import { EvidenceView, RespondentsView, SettlementPanel } from "@/components/features/admin-complaint-parts";
import { SecurityView } from "@/components/features/admin-user-detail-security";
import { healthScore } from "@/server/details-pure";

const DICT = { en, ar, ur };
const wrap = (el: ReactElement, locale: Locale = "en", perms: string[] = []) => renderToStaticMarkup(h(AuthProvider, { user: { id: "u", role: perms.length ? "staff" : "admin", name: "Admin", permissions: perms } as never, children: h(I18nProvider, { locale, dict: DICT[locale], fallback: en, children: el }) }));
/** No raw translation key may reach the screen in any language. */
const clean = (html: string) => { expect(html).not.toMatch(/dv3\.[a-z_0-9]+/); expect(html).not.toContain("undefined"); expect(html).not.toContain("NaN"); return html; };

const kpi = (key: string, unit: string, value: number | null, prev: number | null, good = "higher", sub?: number | string) => ({ key, unit, good, value, prev, sub });
const healthInputs = { daysSinceLastOrder: 3, orders90: 24, successRate: 0.9, cancellationRate: 0.05, openSupport: 1, complaints90: 0 };
const stats = (o: Partial<CompanyStats> = {}): CompanyStats => ({
  period: { key: "30d", from: "2026-10-21", to: "2026-11-19", days: 30, bucket: "day", prevFrom: "2026-09-21", prevTo: "2026-10-20" },
  kpis: [kpi("orders", "count", 12, 8, "higher", 40), kpi("parcels", "count", 130, 100), kpi("success", "percent", 0.91, 0.88, "higher", 120), kpi("cancellation", "percent", 0.08, 0.1, "lower", 1), kpi("on_time", "percent", null, null, "higher", 0),
    kpi("frequency", "rate", 12, 8), kpi("spend", "money", 1_234_500, 900_000, "higher", 11), kpi("aov", "money", 112_227, 100_000, "neutral"), kpi("cod", "money", 50_000, null, "lower"), kpi("support", "count", 2, null, "lower", "1/1"), kpi("health", "score", 82, null)] as never,
  hidden: [], moneyHidden: false, facts: { lastOrderAt: "2026-11-17T08:00:00Z", firstOrderAt: "2026-01-01T08:00:00Z", daysSinceLastOrder: 2, ordersAll: 40, openNow: 3 },
  wallet: { availableCents: 250_000, reservedCents: 40_000, heldCents: 0, creditLimitCents: 100_000, creditUse: 0.25 }, health: healthScore(healthInputs) as never, healthInputs,
  alerts: [{ key: "no_orders", tone: "warn", params: { days: 50 } }, { key: "wallet_low", tone: "danger", params: { ref: "JR-1", need: 50_000, have: 10_000 } }, { key: "wallet_low", tone: "warn", params: { ref: "", need: 100_000, have: 10_000 } },
    { key: "failure_up", tone: "danger", params: { cur: 20, prev: 10 } }, { key: "sla_breached", tone: "danger", params: { n: 2 } }],
  charts: null, generatedAt: "2026-11-19T10:00:00Z", ...o,
});

describe("company KPI strip, health and alerts render in every language", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    it(`the strip: definitions, deltas, wallet and credit line (${locale})`, () => {
      const html = clean(wrap(h(CompanyKpiStrip, { id: "c1", data: stats(), loading: false, period: "30d", onPeriod() {} }), locale));
      for (const id of ["orders", "parcels", "success", "cancellation", "on_time", "frequency", "spend", "aov", "cod", "wallet", "credit", "active", "last_order", "support", "health"]) expect(html, id).toContain(`data-testid="dv3-kpi-${id}"`);
      expect(html).toContain('data-testid="dv3-period-range"'); expect(html).toContain("/admin/companies/c1/orders"); expect(html).toContain("/admin/companies/c1/finance"); expect(html).toContain("/admin/companies/c1/support");
      expect(html).toContain('role="progressbar"'); // credit line use
    });
  }
  it("no data is a dash; a viewer without money permissions simply has no money tiles; loading shows skeletons", () => {
    const sparse = clean(wrap(h(CompanyKpiStrip, { id: "c1", data: stats({ kpis: [kpi("orders", "count", 0, 0), kpi("success", "percent", null, null)] as never, wallet: null, facts: { lastOrderAt: null, firstOrderAt: null, daysSinceLastOrder: null, ordersAll: 0, openNow: 0 }, hidden: ["money", "wallet", "cod"] }), loading: false, period: "30d", onPeriod() {} })));
    expect(sparse).toMatch(/data-testid="dv3-kpi-success-value"[^>]*>—</); expect(sparse).not.toContain('data-testid="dv3-kpi-spend"'); expect(sparse).not.toContain('data-testid="dv3-kpi-wallet"'); expect(sparse).toContain("No orders yet"); expect(sparse).toContain("Not shown with your permissions");
    expect(clean(wrap(h(CompanyKpiStrip, { id: "c1", loading: true, period: "30d", onPeriod() {} })))).toContain("animate-pulse");
    expect(clean(wrap(h(CompanyKpiStrip, { id: "c1", data: stats({ period: { key: "all", from: "2026-01-01", to: "2026-11-19", days: 323, bucket: "month", prevFrom: null, prevTo: null } }), loading: false, period: "all", onPeriod() {} })))).toContain("No comparison for this period");
  });
  it("a tile with a tooltip names its metric for assistive technology", () => {
    const html = clean(wrap(h(KpiTile, { id: "x", label: "Cancellation rate", def: "Share of orders", num: "n", den: "d", value: "8%" })));
    expect(html).toContain("What does “Cancellation rate” mean?"); expect(html).toContain('data-testid="dv3-kpi-x-value"');
  });
  for (const locale of ["en", "ar", "ur"] as const) {
    it(`health: score, band, five parts and the formula (${locale})`, () => {
      const html = clean(wrap(h(CompanyHealth, { stats: stats() }), locale));
      expect(html).toContain('data-testid="dv3-health-score"'); for (const p of ["recency", "frequency", "success", "cancellations", "support"]) expect(html).toContain(`data-testid="dv3-health-part-${p}"`);
    });
  }
  it("health without enough data says so and shows no number", () => {
    const empty = { daysSinceLastOrder: null, orders90: 0, successRate: null, cancellationRate: null, openSupport: 0, complaints90: 0 };
    const html = clean(wrap(h(CompanyHealth, { stats: stats({ health: healthScore(empty) as never, healthInputs: empty }) })));
    expect(html).toContain("Not enough data"); expect(html).toMatch(/dv3-health-score"[^>]*>—</); expect(html).not.toContain('role="progressbar"');
    expect(wrap(h(CompanyHealth, { stats: stats({ health: null, healthInputs: null }) }))).toBe(""); // a viewer without order access sees no card
  });
  for (const locale of ["en", "ar", "ur"] as const) {
    it(`alerts: every rule renders with its numbers (${locale})`, () => {
      const html = clean(wrap(h(CompanyAlerts, { alerts: stats().alerts }), locale));
      for (const k of ["no_orders", "wallet_low", "failure_up", "sla_breached"]) expect(html).toContain(`data-testid="dv3-alert-${k}"`);
    });
  }
  it("alert texts carry their numbers (English)", () => {
    const html = clean(wrap(h(CompanyAlerts, { alerts: stats().alerts })));
    expect(html).toContain("50 days"); expect(html).toContain("JR-1"); expect(html).toContain("from 10% to 20%"); expect(html).toContain("2 open ticket"); expect(html).toContain("less than the average order");
    expect(wrap(h(CompanyAlerts, { alerts: [] }))).toBe("");
  });
});

const person: PersonCard = {
  id: "p1", name: "Sara Ali", company: "Alpha Trading", role: "business", status: "active", city: "riyadh", phone: "+9665•••12", email: "sara@alpha.test", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-11-19T07:00:00Z",
  href: "/admin/companies/p1", userHref: "/admin/users/p1", stats: { tickets: { total: 3, open: 1 }, complaints: { total: 1, open: 0 }, orders: 12, rating: { avg: 4.6, count: 9 }, lastTickets: [{ id: "t9", ref: "TK-9", subject: "Earlier", status: "resolved", createdAt: "2026-11-01T00:00:00Z" }] },
};
const related: Related = {
  request: { id: "r1", ref: "JR-1", status: "in_progress", service: "delivery_driver", title: null, pickupCity: "riyadh", deliveryCity: "jeddah", startsAt: "2026-11-19T09:00:00Z", createdAt: "2026-11-18T09:00:00Z", completedAt: null, cancelledAt: null, cancelReason: null, quantity: 2, slotsFilled: 1, createdVia: "web", totalCents: 12_000 },
  offer: { id: "o1", status: "arrived", acceptedAt: "2026-11-18T10:00:00Z", arrivedAt: "2026-11-19T09:40:00Z", deliveredAt: null, expectedUnits: 10, deliveredUnits: null, finalUnits: null, expectedEarningCents: 7000, driver: { id: "d1", name: "Omar Driver" }, office: null },
  driver: { id: "d1", name: "Omar Driver", status: "active", city: "riyadh", vehicleType: "sedan", availability: "available", verificationStatus: "verified", jobsCompleted: 31, rating: 4.8, href: "/admin/drivers/d1" },
  company: { id: "p1", name: "Alpha Trading", status: "active", city: "riyadh", verificationStatus: "verified", orders: 12, href: "/admin/companies/p1" }, hidden: [],
};
describe("ticket and complaint cards", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    it(`requester card and the four related cards (${locale})`, () => {
      const html = clean(wrap(h("div", null, h(PersonCardView, { p: person, title: "Requester", testId: "dv3-requester" }), h(RelatedCardsView, { r: related })), locale));
      for (const id of ["dv3-requester", "dv3-rel-request", "dv3-rel-offer", "dv3-rel-driver", "dv3-rel-company"]) expect(html, id).toContain(`data-testid="${id}"`);
      expect(html).toContain('href="/admin/companies/p1"'); expect(html).toContain('href="/admin/users/p1"'); expect(html).toContain('href="/admin/requests/r1"'); expect(html).toContain('href="/admin/cases/t9"'); expect(html).toContain('href="/admin/drivers/d1"');
    });
  }
  it("a viewer without permissions gets no links to pages they cannot open, and hidden cards are named", () => {
    const html = clean(wrap(h("div", null, h(PersonCardView, { p: person, title: "Requester", testId: "dv3-requester" }), h(RelatedCardsView, { r: { ...related, request: null, offer: null, driver: null, company: null, hidden: ["request", "driver"] } })), "en", ["tickets.view"]));
    expect(html).not.toContain('href="/admin/companies/p1"'); expect(html).not.toContain('href="/admin/users/p1"'); expect(html).toContain("Not shown with your permissions"); expect(html).toContain("order, driver");
    expect(wrap(h(RelatedCardsView, { r: { request: null, offer: null, driver: null, company: null, hidden: [] } }))).toBe(""); // nothing linked: no empty frame
  });
  it("a requester with no history and no rating shows only what exists", () => {
    const html = clean(wrap(h(PersonCardView, { p: { ...person, company: null, phone: null, email: null, lastSeenAt: null, stats: { tickets: null, complaints: null, orders: null, rating: null, lastTickets: null } }, title: "Requester", testId: "dv3-requester" })));
    expect(html).not.toContain("Their latest tickets"); expect(html).not.toContain("Rating"); expect(html).toContain("—");
    expect(wrap(h(PersonCardView, { p: null, title: "x", testId: "x" }))).toBe("");
  });
});

describe("deadlines, history, outcomes and similar cases", () => {
  it("both SLA clocks with their state, target and time left (and over)", () => {
    const now = Date.now();
    const html = clean(wrap(h(SlaClocks, { row: { createdAt: new Date(now - 3600e3).toISOString(), firstResponseAt: null, resolvedAt: null } })));
    expect(html).toContain('data-testid="dv3-sla-first"'); expect(html).toContain('data-state="on_track"'); expect(html).toContain("Target 4 h"); expect(html).toContain("Target 2 d"); expect(html).toMatch(/3 h .*left/);
    const late = clean(wrap(h(SlaClocks, { row: { createdAt: new Date(now - 6 * 3600e3).toISOString(), firstResponseAt: null, resolvedAt: null } })));
    expect(late).toContain('data-state="breached"'); expect(late).toContain("overdue");
    const done = clean(wrap(h(SlaClocks, { row: { createdAt: new Date(now - 6 * 3600e3).toISOString(), firstResponseAt: new Date(now - 5.9 * 3600e3).toISOString(), resolvedAt: new Date(now - 5 * 3600e3).toISOString() } })));
    expect(done).toContain('data-state="met"'); expect(done).toContain("Done in");
    for (const l of ["ar", "ur"] as const) clean(wrap(h(SlaClocks, { row: { createdAt: new Date(now - 3600e3).toISOString(), firstResponseAt: null, resolvedAt: null } }), l));
  });
  it("handling history lists the opening, the first response and every change with who made it", () => {
    const html = clean(wrap(h(HandlingHistory, { kind: "ticket", ms: { createdAt: "2026-11-19T06:00:00Z", firstResponseAt: "2026-11-19T06:30:00Z", firstResponseBy: { id: "s", name: "Sara" }, resolvedAt: "2026-11-19T09:00:00Z", reopenCount: 1 },
      history: [{ id: "1:0", at: "2026-11-19T07:00:00Z", kind: "status", from: "open", to: "in_review", actor: { id: "s", name: "Sara" } }, { id: "1:1", at: "2026-11-19T07:00:00Z", kind: "priority", from: "normal", to: "urgent", actor: { id: "s", name: "Sara" } },
        { id: "1:2", at: "2026-11-19T07:00:00Z", kind: "assign", from: null, to: "Sara", actor: { id: "s", name: "Sara" } }, { id: "2:0", at: "2026-11-19T08:00:00Z", kind: "reopen", from: "resolved", to: "open", actor: { id: "s", name: "Sara" } }] })));
    for (const text of ["Opened", "First response by Sara", "Status changed from Open to In review", "Priority changed from Normal to Urgent", "Assigned to Sara", "Reopened", "Resolved"]) expect(html, text).toContain(text);
    expect((html.match(/data-testid="dv3-history-item"/g) ?? []).length).toBe(7);
    for (const l of ["ar", "ur"] as const) clean(wrap(h(HandlingHistory, { kind: "complaint", ms: { createdAt: "2026-11-19T06:00:00Z", firstResponseAt: null, firstResponseBy: null, resolvedAt: null }, history: [{ id: "c", at: "2026-11-19T07:00:00Z", kind: "hold", from: null, to: "on", actor: { id: null, name: null } }] }), l));
  });
  it("outcomes of similar cases, and the 'none yet' text", () => {
    const html = clean(wrap(h(OutcomeStats, { category: "Late delivery", o: { total: 10, resolved: 7, open: 2, avgFirstResponseSec: 5400, avgResolutionSec: 90_000, firstResponseLateRate: 0.2, holdRate: 0.3 } })));
    expect(html).toContain("70%"); expect(html).toContain("1 h 30 min"); expect(html).toContain("20%"); expect(html).toContain("30%");
    expect(clean(wrap(h(OutcomeStats, { category: "Late delivery", o: { total: 0, resolved: 0, open: 0, avgFirstResponseSec: null, avgResolutionSec: null, firstResponseLateRate: null } })))).toContain("No other Late delivery cases");
    expect(clean(wrap(h(SimilarCases, { kind: "complaint", items: [{ id: "c1", ref: "CP-1", status: "resolved", createdAt: "2026-11-01T00:00:00Z", filer: "Alpha", resolution: "Late fee credited", holdsSettlement: true }] })))).toContain("Late fee credited");
    expect(clean(wrap(h(SimilarCases, { kind: "ticket", items: [] })))).toContain("No similar cases");
  });
});

describe("complaint parts", () => {
  it("evidence: timeline against the start time with the lateness, parcels, chat, ratings", () => {
    const html = clean(wrap(h(EvidenceView, { hidden: false, e: { startsAt: "2026-11-19T07:00:00Z", timeline: [{ key: "accepted", at: "2026-11-18T07:00:00Z" }, { key: "arrived", at: "2026-11-19T09:00:00Z" }], offerStatus: "arrived", lateMinutes: 120, units: { expected: 10, delivered: null, final: null, loaded: 10 },
      parcels: { byStatus: { delivered: 6, failed: 2 }, failureReasons: [{ key: "refused", value: 2 }] }, chat: [{ id: "m1", at: "2026-11-19T08:00:00Z", name: "Omar", role: "driver", body: "Stuck in traffic" }], ratings: [{ stars: 2, comment: "Late", rater: "Sara", raterId: "p1" }], custody: [{ type: "phone", status: "handed_over", qty: 1 }] } })));
    expect(html).toContain("Arrived 120 min late"); expect(html).toContain("Stuck in traffic"); expect(html).toContain('data-testid="dv3-evidence-timeline"'); expect(html).toContain("Recipient refused");
    expect(clean(wrap(h(EvidenceView, { hidden: true, e: null })))).toContain("orders permission"); expect(clean(wrap(h(EvidenceView, { hidden: false, e: null })))).toContain("No order linked");
  });
  it("respondents and the settlement panel with its hold, amounts and release effect", () => {
    expect(clean(wrap(h(RespondentsView, { r: { basis: "offer", items: [{ id: "d1", name: "Omar Driver", role: "driver", href: "/admin/drivers/d1" }] } })))).toContain("/admin/drivers/d1");
    expect(clean(wrap(h(RespondentsView, { r: { basis: "none", items: [] } })))).toContain("No other party");
    const s = { holds: true, active: true, moneyHidden: false, otherHolds: [{ id: "c2", ref: "CP-2", status: "open" }], items: [{ id: "s1", status: "approved", requestId: "r1", ref: "JR-1", finalUnits: 10, createdAt: "2026-11-19T00:00:00Z", paidAt: null, customerCents: 12_000, providerCents: 8000, marginCents: 4000, vatCents: 600, refundCents: 0, adjustmentCents: 0 }] };
    const html = clean(wrap(h(SettlementPanel, { s, holds: true })));
    expect(html).toContain("holding the payment"); expect(html).toContain("releases the payment automatically"); expect(html).toContain("80.00"); expect(html).toContain('href="/admin/finance/settlements"'); expect(html).toContain('href="/admin/complaints/c2"');
    const hidden = clean(wrap(h(SettlementPanel, { s: { ...s, moneyHidden: true, items: [{ ...s.items[0], customerCents: undefined, providerCents: undefined, marginCents: undefined }] }, holds: true }), "en", ["complaints.manage"]));
    expect(hidden).toContain("Amounts need the finance permission"); expect(hidden).not.toContain("80.00"); expect(hidden).not.toContain("/admin/finance/settlements");
    expect(clean(wrap(h(SettlementPanel, { s: { holds: false, active: false, moneyHidden: false, otherHolds: [], items: [] }, holds: false })))).toContain("No settlement exists yet");
    expect(clean(wrap(h(SettlementPanel, { s: { holds: true, active: false, moneyHidden: false, otherHolds: [], items: [] }, holds: true })))).toContain("hold ended");
    for (const l of ["ar", "ur"] as const) clean(wrap(h(SettlementPanel, { s, holds: true }), l));
  });
});

describe("security view (shared by company and user)", () => {
  it("renders its loading state without a fetch (the data arrives client-side)", () => { expect(wrap(h(SecurityView, { path: "/admin/users/x/security" }))).toContain("animate-pulse"); });
});
