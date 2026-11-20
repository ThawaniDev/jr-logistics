import { describe, it, expect, vi } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/components/layout/auth-context";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";

/**
 * Render smoke test of the order and parcel views: every section is rendered to static markup with API-shaped fixtures (no browser, no database) in English,
 * Arabic and Urdu, so a missing field, a bad translation key or a crash on sparse data shows up here and not in front of a user.
 */
const fx: Record<string, unknown> = {};
vi.mock("@/components/ui/data", () => ({
  useApi: (path: string | null) => { const k = path ? Object.keys(fx).find((p) => path.startsWith(p)) : undefined; return { data: k ? fx[k] : undefined, error: undefined, mutate: () => {}, isLoading: false }; },
  useUrlState: (_k: string, initial = "") => [initial, () => {}], useUrlPatch: () => () => {},
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/requests/r1", useRouter: () => ({ replace() {}, push() {} }), useSearchParams: () => new URLSearchParams((globalThis as { __sp?: string }).__sp ?? "") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: Record<string, unknown> & { children?: unknown }) => h("a", { href: href as string, ...p }, children as never) }));
vi.mock("@/components/features/activity-log", () => ({ ActivityLog: () => h("div", { "data-testid": "dtk-log" }) }));
vi.mock("@/components/features/notes-panel", () => ({ NotesPanel: () => h("div", { "data-testid": "dtk-notes" }) }));
vi.mock("@/components/features/admin-order-map-view", () => ({ OrderMap: ({ points }: { points: unknown[] }) => h("div", { "data-testid": "map-stub", "data-points": points.length }) }));

import { OrderProvider } from "@/components/features/admin-order-ctx";
import { OrderShell } from "@/components/features/admin-order-shell";
import { OrderOverview } from "@/components/features/admin-order-overview";
import { OrderDrivers } from "@/components/features/admin-order-drivers";
import { OrderParcels } from "@/components/features/admin-order-parcels";
import { OrderMoney } from "@/components/features/admin-order-money";
import { OrderComms } from "@/components/features/admin-order-comms";
import { OrderActivity } from "@/components/features/admin-order-activity";
import { ParcelView } from "@/components/features/admin-parcel-view";
import { ParcelSearch } from "@/components/features/admin-parcel-search";

const DICT = { en, ar, ur };
const user = (permissions: string[] = []) => ({ id: "u", role: "admin", name: "Admin", permissions } as never);
const render = (el: ReactElement, locale: Locale = "en") => renderToStaticMarkup(h(AuthProvider, { user: user(), children: h(I18nProvider, { locale, dict: DICT[locale], fallback: en, children: el }) }));
const T = "2026-11-19T08:00:00.000Z";
const ms = (key: string, at: string | null, fromPrevS: number | null = null) => ({ key, at, fromPrevS, sinceCreatedS: at ? 60 : null });

const request = { id: "r1", ref: "JR-000001", businessId: "b1", service: "delivery_driver", status: "in_progress", quantity: 2, slotsFilled: 1, vehicleType: "dokker", temperature: "cold", pickupCity: "riyadh", deliveryCity: "jeddah", pickupAddress: "Warehouse 4", deliveryAddress: null, startsAt: T, durationDays: 1, notes: "Call first", allowPartial: false, createdVia: "api", totalCents: 4000, reservedCents: 4000, createdAt: T, publishedAt: T, cancelReason: null, shipmentsPerDriver: 10, pricingSnapshot: { unit: "shipment", unitPriceCents: 1000, totalUnits: 4, totalCents: 4000, providerCostCents: 700, providerTotalCents: 2800, marginCents: 1200, ruleVersion: 1, quantity: 2, expectedUnits: 2, currency: "SAR", ruleId: "x", effectiveAt: T, expiresAt: null, agreementRef: "AG-1" } };
const kpis = (o: Record<string, unknown> = {}) => ({
  slots: { filled: 1, needed: 2 }, parcels: { total: 4, delivered: 2, failed: 1, returned: 0, missing: 0, cancelled: 0, pending: 1, pendingHandover: 0, onBoard: 1, unassigned: 1, defers: 1 }, successRate: 2 / 3, firstAttemptRate: 0.5,
  start: { startsAt: T, firstArrivalAt: T, deltaMin: 45, lastDeltaMin: 45, arrived: 1, late: 1, onTime: 0, graceMin: 30 }, timeToFirstOfferS: 30, timeToFirstAcceptS: 600, timeToFillS: null, executionS: 7200, executionRunning: true,
  rating: { avg: 4.5, count: 2 }, support: { open: 1, total: 2 }, money: { totalCents: 4000, providerCents: 2800, marginCents: 1200, reservedCents: 4000, settled: null }, cod: { dueCents: 15000, collectedCents: 15000, remittedCents: 5000, outstandingCents: 10000 }, ...o,
});
const overview = (o: Record<string, unknown> = {}) => ({
  request, company: { id: "b1", name: "Alpha Foods", contactName: "Sara", phone: "+966•••01", crNumber: "1010" },
  flags: { allOrNothing: true, detailsLater: true, partnerCreated: true, partnerParcels: 2, createdVia: "api", manifest: true, closed: null }, access: { finance: true, pricing: true, cod: true, sensitive: true, support: true },
  kpis: kpis(), milestones: [ms("created", T), ms("published", T, 60), ms("first_offer", T, 5), ms("first_accepted", T, 600), ms("filled", null), ms("started", T, 900), ms("loaded", T, 60), ms("first_delivery", T, 300), ms("closed", null)], graceMin: 30,
  funnel: { offered: 5, accepted: 2, arrived: 1, attendance: 1, loaded: 1, delivered: 0, cancelled: 1, noShow: 1, replaced: 0, rejected: 1, expired: 0 },
  parcelMix: { pending: 0, loaded: 1, delivered: 2, failed: 1, returned: 0, missing: 0, cancelled: 0 }, failureReasons: [{ reason: "refused", n: 1 }, { reason: "custom_reason", n: 1 }, { reason: "more", n: 2 }],
  delivery: { n: 2, p50: 1500, p90: 4000, edges: [900, 1800], buckets: [{ from: 0, to: 900, count: 1 }, { from: 900, to: 1800, count: 1 }, { from: 1800, to: null, count: 0 }] },
  map: { pickup: { lat: 24.7, lng: 46.6 }, points: [{ id: "p1", seq: 1, code: "JR-000001-001", lat: 24.71, lng: 46.61, status: "delivered" }], located: 1, unlocated: 3 },
  alerts: [{ key: "driver_late", severity: "critical", params: { n: 1, min: 75 } }, { key: "no_coords", severity: "warning", params: { n: 3 } }, { key: "cod_outstanding", severity: "warning", params: { cents: 10000 } }, { key: "unfilled", severity: "warning", params: { n: 1, min: 90 } }], ...o,
});
const offer = (o: Record<string, unknown> = {}) => ({
  id: "o1", status: "attendance_confirmed", source: "manual", isReplacement: false, replacesOfferId: null, driver: { id: "d1", name: "Nasser", phone: "+966•••14", vehicleType: "van", plate: "ABC 123", rating: 4.5, ratingCount: 2, jobsCompleted: 9 },
  officeId: "of1", office: { id: "of1", name: "Fast Office" }, expectedUnits: 4, loadedUnits: 4, deliveredUnits: null, finalUnits: null, loadedAckByDriver: true, expectedEarningCents: 2800, createdAt: T, acceptedAt: T, arrivedAt: T, loadedAt: T, routeApprovedAt: T, deliveredAt: null, finalAt: null, cancelledAt: null, cancelReason: null,
  steps: [{ key: "offered", at: T, fromPrevS: null }, { key: "accepted", at: T, fromPrevS: 120 }, { key: "arrived", at: T, fromPrevS: 3600 }], responseS: 120,
  arrival: { at: T, lateMin: 45, distanceM: 35, pinKnown: true, lat: 24.7, lng: 46.6 }, attendance: { at: T, byName: "Ops Omar" },
  loading: { mode: "driver_scan", assigned: 4, scanned: 3, unscanned: 1, viaScan: 3, viaWarehouse: 0, finished: true, durationS: 600, firstAt: T, lastAt: T },
  routePlan: { provider: "google_routes" }, route: { provider: "google_routes", plannedAt: T, by: "system", manual: true, distanceM: 12500, durationS: 3000, stops: 4, unlocated: 1, warnings: 1, approvedAt: T },
  parcels: { total: 4, pending: 1, onBoard: 0, delivered: 2, failed: 1, returned: 0, missing: 0, defers: 1, noCoords: 1, successRate: 2 / 3, firstAttemptRate: 0.5, avgDwellS: 240, firstDeliveredAt: T, lastOutcomeAt: T },
  cod: { collectedCents: 15000, receivedCents: 5000, outstandingCents: 10000 }, rating: { stars: 5, comment: "Great", at: T }, chat: { count: 3, lastAt: T }, ...o,
});
const idleOffer = offer({ id: "o2", status: "expired", acceptedAt: null, arrivedAt: null, steps: [], responseS: null, arrival: { at: null, lateMin: null, distanceM: null, pinKnown: false, lat: null, lng: null }, route: null, routePlan: null, expectedEarningCents: null, rating: null, chat: { count: 0, lastAt: null }, office: null, officeId: null });
const parcelRow = (o: Record<string, unknown> = {}) => ({ id: "p1", seq: 1, code: "JR-000001-001", externalRef: "ORD-1", recipientType: "business", recipientName: "Ali", recipientPhone: "+966•••12", address: "1 Olaya St", city: "riyadh", located: false, status: "failed", offerId: "o1", driverName: "Nasser", attempts: 2, deferCount: 1, stopOrder: 3, proofType: null, hasProof: false, receiverName: null, codCents: 7500, codCollectedCents: null, codCollectedAt: null, loadedAt: T, loadedVia: "driver_scan", arrivedAt: T, deliveredAt: null, failedAt: T, returnedAt: null, dwellS: 240, failReason: "refused", failNote: "gate closed", deliveredDistanceM: 800, detailsComplete: false, partnerId: "pc", partnerStatus: "Ready", ...o });
const parcels = { page: 1, pageSize: 50, total: 2, items: [parcelRow(), parcelRow({ id: "p2", seq: 2, code: "JR-000001-002", status: "delivered", proofType: "receipt", hasProof: true, receiverName: "Sam", codCents: 0, failReason: null, failNote: null, deliveredAt: T, failedAt: null, detailsComplete: true, partnerStatus: null, deliveredDistanceM: 12, located: true })], counts: { failed: 1, delivered: 1 }, cities: [{ city: "riyadh", n: 2 }], drivers: [{ offerId: "o1", name: "Nasser", status: "attendance_confirmed", n: 1 }, { offerId: null, name: null, status: null, n: 1 }], withCod: 1, incomplete: 1 };
const money = {
  request: { id: "r1", ref: "JR-000001", status: "in_progress", totalCents: 4000, unitPriceCents: 1000, reservedCents: 4000, expectedUnits: 2, quantity: 2 },
  pricing: { snapshot: request.pricingSnapshot, rule: { id: "x", version: 1, status: "retired", vehicleType: "dokker", temperature: null, pickupCity: "riyadh", deliveryCity: null, businessSpecific: true, unit: "shipment", priceCents: 1000, providerCostCents: 700, agreementRef: "AG-1", effectiveAt: T, expiresAt: null } },
  reservation: { currentCents: 4000, reservedCents: 4000, releasedCents: 0, entries: [{ kind: "reserve", n: 1, availableCents: -4000, reservedCents: 4000, heldCents: 0 }, { kind: "weird_kind", n: 1, availableCents: 0, reservedCents: 0, heldCents: 0 }] },
  totals: { settlements: 1, customerCents: 4000, providerCents: 2800, marginCents: 1200, vatCents: 521, refundCents: 0, adjustmentCents: 0, invoicedCents: 4000 },
  settlements: [{ id: "s1", offerId: "o1", status: "batch_ready", driverId: "d1", driverName: "Nasser", officeId: null, officeName: "Fast Office", finalUnits: 4, reservedCents: 4000, customerCents: 4000, providerCents: 2800, marginCents: 1200, vatCents: 521, refundCents: 0, adjustmentCents: 0, note: "ok", reviewer: "A", approver: "B", createdAt: T, approvedAt: T, paidAt: null }],
  invoices: [{ id: "i1", number: "INV-1", settlementId: "s1", subtotalCents: 3479, vatCents: 521, totalCents: 4000, vatPct: 15, createdAt: T }],
  ledger: { page: 1, pageSize: 50, total: 1, items: [{ id: "l1", kind: "reserve", availableCents: -4000, reservedCents: 4000, heldCents: 0, offerId: null, settlementId: null, note: null, simulated: true, accountKind: "user", owner: "Alpha Foods", ownerRole: "business", actor: null, createdAt: T }] },
  adjustments: [{ id: "a1", kind: "refund", amountCents: 500, note: "goodwill", owner: "Alpha Foods", actor: "Admin", createdAt: T }],
  cod: { drivers: [{ offerId: "o1", driverId: "d1", driverName: "Nasser", parcels: 2, dueCents: 15000, collectedCents: 15000, receivedCents: 5000, outstandingCents: 10000, lastCollectedAt: T }], totals: { dueCents: 15000, collectedCents: 15000, receivedCents: 5000, outstandingCents: 10000 }, remittances: [{ id: "c1", ref: "RM-1", offerId: "o1", driverName: "Nasser", amountCents: 5000, receivedBy: "Sara", receivedByRole: "business", note: null, createdAt: T }] },
};
const comms = { request: { id: "r1", ref: "JR-000001" }, chat: { total: 2, shown: 2, truncated: false, threads: [{ offerId: "o1", status: "attendance_confirmed", driverId: "d1", driverName: "Nasser", messages: [{ id: "m1", senderId: "b1", senderRole: "business", senderName: "Sara", body: "Hello <b>x</b>", createdAt: T }, { id: "m2", senderId: "d1", senderRole: "driver", senderName: "Nasser", body: "On my way", createdAt: T }] }] },
  messages: { page: 1, pageSize: 50, total: 2, stats: [{ channel: "sms", status: "failed", n: 1 }, { channel: "webhook", status: "delivered", n: 1 }], items: [{ id: "g1", channel: "sms", type: "recipient_code", recipient: "•••• 0001", status: "failed", error: "provider down", attempts: 2, sentAt: T, createdAt: T, shipmentId: "p1", shipmentCode: "JR-000001-001" }, { id: "g2", channel: "webhook", type: "order.updated", recipient: "example.com", status: "delivered", error: null, attempts: 1, sentAt: null, createdAt: T, shipmentId: null, shipmentCode: null }] },
  notifications: { total: 1, shown: 1, items: [{ id: "n1", type: "driver_arrived", data: { ref: "JR-000001", driver: "Nasser" }, readAt: null, createdAt: T, userId: "b1", userName: "Sara", userRole: "business" }] } };
const detail = {
  parcel: { id: "p1", seq: 1, code: "JR-000001-001", externalRef: "ORD-1", recipientType: "consumer", status: "failed", contents: "Books", notes: "Fragile", detailsComplete: false, attempts: 2, deferCount: 1, stopOrder: 3, loadedVia: "driver_scan", geoSource: "geocoded", createdAt: T, updatedAt: T, loadedAt: T, arrivedAt: T, deliveredAt: null, failedAt: T, returnedAt: null, failReason: "refused", failNote: "gate closed", proofType: null, receiverName: null, hasProof: true, notifiedAt: T },
  recipient: { name: "Ali", phone: "+966•••12", type: "consumer", address: "1 Olaya St", city: "riyadh" },
  location: { pin: { lat: 24.7, lng: 46.6 }, delivered: { lat: 24.71, lng: 46.61 }, deliveredHidden: false, distanceM: 800, geoSource: "geocoded", sensitive: true },
  request: { id: "r1", ref: "JR-000001", status: "in_progress", service: "delivery_driver", businessId: "b1", businessName: "Alpha Foods", pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: T, pickupLat: 24.7, pickupLng: 46.6 },
  offer: { id: "o1", status: "attendance_confirmed", driverId: "d1", driverName: "Nasser", officeId: null, routeApprovedAt: T },
  journey: [{ id: "e1", type: "created", createdAt: T, actorName: null, actorRole: "business", offerId: null, payload: { backfill: true }, fromPrevS: null }, { id: "e2", type: "failed", createdAt: T, actorName: "Nasser", actorRole: "driver", offerId: "o1", payload: { reason: "refused", note: "gate", distanceM: 800 }, fromPrevS: 90 }, { id: "e3", type: "mystery_event", createdAt: T, actorName: null, actorRole: "system", offerId: null, payload: null, fromPrevS: 5 }],
  attempts: [{ n: 1, arrivedAt: T, outcome: "failed", outcomeAt: T, durationS: 240, reason: "refused", note: "gate", otpFailures: 2, offerId: "o1", actorName: "Nasser" }, { n: 2, arrivedAt: T, outcome: null, outcomeAt: null, durationS: null, reason: null, note: null, otpFailures: 0, offerId: "o1", actorName: "Nasser" }],
  media: [{ id: "m1", kind: "fail", note: "closed gate", createdAt: T, by: "Nasser" }],
  otp: { sends: 1, resends: 1, wrongAttempts: 2, sentEvents: 2, failedEvents: 2, notifyFailed: 1, verifiedAt: null, verifiedBy: null, lastSentAt: T },
  messages: { stats: { sent: 1, failed: 1 }, items: [{ id: "g1", channel: "sms", type: "recipient_code", recipient: "•••• 0001", status: "failed", error: "provider down", attempts: 1, at: T }] },
  cod: { dueCents: 7500, collectedCents: null, collectedAt: null, collectedBy: null, offer: { collectedCents: 15000, receivedCents: 5000, outstandingCents: 10000 }, remittances: [{ id: "c1", ref: "RM-1", amountCents: 5000, receivedBy: "Sara", createdAt: T }] },
  route: { stopOrder: 3, plannedDistanceM: 2300, plannedDurationS: 600, actualLegS: 900, provider: "local_heuristic", plannedAt: T, manual: true, dwellS: 240 },
  partner: { connected: true, partnerStatus: "Ready", partnerStatusAt: T, order: { provider: "logestechs", state: "linked", externalId: "x", externalRef: "ORD-1", awb: "AWB1", connection: "Main", connectionStatus: "active", cancelledAt: null, cancelReason: null }, outbox: [{ status: "dead", n: 1, lastError: "HTTP 500", lastSentAt: null }, { status: "sent", n: 3, lastError: null, lastSentAt: T }], events: [{ id: "x1", direction: "out", kind: "status", outcome: "ok", summary: "picked_up", at: T }] },
  similar: { byPhone: [{ id: "p9", code: "JR-000002-001", status: "delivered", recipientName: "Ali", requestId: "r2", requestRef: "JR-000002", createdAt: T }], byAddress: [] },
};
const search = { page: 1, pageSize: 25, total: 1, items: [{ id: "p1", code: "JR-000001-001", externalRef: "ORD-1", recipientName: "Ali", recipientPhone: "+966•••12", status: "failed", city: "riyadh", requestId: "r1", requestRef: "JR-000001", businessName: "Alpha Foods", offerId: "o1", driverName: "Nasser", partnerId: null, partnerStatus: null, createdAt: T }] };

const ctx = (data: unknown) => ({ id: "r1", data, refresh: async () => {}, openModal: () => {} });
const inOrder = (el: ReactElement, data: unknown = overview()) => h(OrderProvider, { value: ctx(data), children: el });
const sections: Array<[string, () => ReactElement, string[]]> = [
  ["overview", () => inOrder(h(OrderOverview)), ["dv1-alerts", "dv1-milestones", "dv1-funnel", "dv1-mix", "dv1-reasons", "dv1-delivery", "map-stub", "dtk-log", "admin-req-open-ledger"]],
  ["drivers", () => inOrder(h(OrderDrivers)), ["dv1-offers", "admin-offer-o1", "admin-offer-o2", "dv1-steps-o1", "dv1-arrival-o1", "dv1-loading-o1", "dv1-route-o1", "dv1-parcels-o1", "dv1-gps-o1", "dv1-driver-link-o1", "dv1-office-link-o1"]],
  ["parcels", () => inOrder(h(OrderParcels)), ["admin-parcel-row", "dv1-parcel-link", "admin-parcel-cod", "admin-parcels-export", "admin-parcels-total"]],
  ["money", () => inOrder(h(OrderMoney)), ["dv1-money", "dv1-price-build", "dv1-settlement-row", "dv1-cod-row", "dv1-ledger-row", "dv1-open-ledger"]],
  ["communication", () => inOrder(h(OrderComms)), ["dv1-comms", "dv1-chat-thread", "dv1-msg-row", "dv1-msg-failed", "dv1-notif-row"]],
  ["activity", () => inOrder(h(OrderActivity)), ["dv1-activity", "dtk-log", "dtk-notes", "dtk-raw-toggle"]],
  ["parcel", () => h(ParcelView, { id: "p1" }), ["dv1-journey", "dv1-attempt-row", "dv1-evidence-item", "dv1-parcel-order-link", "dv1-parcel-driver-link", "dv1-parcel-messages", "dv1-parcel-cod", "dv1-parcel-route", "dv1-parcel-partner", "dv1-similar-item", "dtk-notes", "dv1-parcel-fail"]],
  ["search", () => h(ParcelSearch), ["dv1-search-row", "dv1-search-total"]],
];
Object.assign(fx, { "/admin/requests/r1/overview": overview(), "/admin/requests/r1/offers": { request: { id: "r1", ref: "JR-000001", status: "in_progress", service: "delivery_driver", startsAt: T, businessId: "b1", pickup: { lat: 24.7, lng: 46.6 } }, sensitive: true, manifest: true, items: [offer(), idleOffer] },
  "/admin/requests/r1/parcels": parcels, "/admin/requests/r1/money": money, "/admin/requests/r1/communication": comms, "/admin/shipments/p1/detail": detail, "/admin/shipments/search": search, "/admin/users/b1": { user: { phone: "+966500000001" }, profile: { companyName: "Alpha Foods", crNumber: "1010" } }, "/catalog": { cities: [{ key: "riyadh", en: "Riyadh", ar: "الرياض", ur: "ریاض" }] } });

describe("order and parcel views render", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    for (const [name, make, ids] of sections) {
      it(`${name} (${locale}): every block renders and no translation key is left on screen`, () => {
        (globalThis as { __sp?: string }).__sp = name === "search" ? "q=JR-000001" : "";
        const html = render(make(), locale);
        for (const id of ids) expect(html, id).toContain(`data-testid="${id}"`);
        expect(html).not.toMatch(/dv1\.[a-z_]+/);
        expect(html).not.toContain("undefined"); expect(html).not.toContain("NaN"); expect(html).not.toContain("[object Object]");
      });
    }
  }
  it("the shell shows the header facts, flags, tabs and the key figures with their definitions", () => {
    const html = render(h(OrderShell, { id: "r1", children: h("p", null, "child") }));
    expect(html).toContain("JR-000001"); expect(html).toContain("Alpha Foods"); expect(html).toContain('href="/admin/companies/b1"');
    for (const f of ["dv1-flag-all-or-nothing", "dv1-flag-details-later", "dv1-flag-partner", "dv1-flag-via"]) expect(html, f).toContain(f);
    for (const k of ["slots", "parcels", "success", "first_attempt", "start", "first_offer", "fill", "execution", "price", "provider", "margin", "cod_due", "cod_collected", "cod_outstanding", "rating", "support"]) expect(html, k).toContain(`data-testid="dv1-kpi-${k}"`);
    for (const href of ["/admin/requests/r1", "/admin/requests/r1/drivers", "/admin/requests/r1/parcels", "/admin/requests/r1/money", "/admin/requests/r1/communication", "/admin/requests/r1/activity"]) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain("admin-req-cancel"); expect(html).not.toContain("admin-req-assign"); // in progress: cancel yes, assigning no
    expect(html).toContain("45 min late"); // start punctuality
    expect(html).toContain("child");
  });
  it("hides the money tab and the money cards for staff without finance.view, and the parcels tab for orders without a manifest", () => {
    fx["/admin/requests/r1/overview"] = overview({ kpis: kpis({ money: null, cod: null }), flags: { allOrNothing: false, detailsLater: false, partnerCreated: false, partnerParcels: 0, createdVia: "web", manifest: false, closed: null } });
    const html = renderToStaticMarkup(h(AuthProvider, { user: { id: "s", role: "staff", name: "S", permissions: ["requests.view"] } as never, children: h(I18nProvider, { locale: "en", dict: en, fallback: en, children: h(OrderShell, { id: "r1", children: null }) }) }));
    expect(html).not.toContain('href="/admin/requests/r1/money"'); expect(html).not.toContain('href="/admin/requests/r1/parcels"');
    expect(html).not.toContain("dv1-kpi-price"); expect(html).not.toContain("dv1-kpi-cod_due"); expect(html).not.toContain("dv1-flag-partner");
    fx["/admin/requests/r1/overview"] = overview();
  });
  it("sparse data does not crash: an empty order, an order without drivers or parcels, a parcel without any history", () => {
    const empty = overview({ kpis: kpis({ parcels: { total: 0, delivered: 0, failed: 0, returned: 0, missing: 0, cancelled: 0, pending: 0, pendingHandover: 0, onBoard: 0, unassigned: 0, defers: 0 }, successRate: null, firstAttemptRate: null, start: { startsAt: T, firstArrivalAt: null, deltaMin: null, lastDeltaMin: null, arrived: 0, late: 0, onTime: 0, graceMin: 30 }, timeToFirstOfferS: null, timeToFirstAcceptS: null, executionS: null, executionRunning: false, rating: { avg: null, count: 0 }, support: null, money: null, cod: null }), alerts: [], failureReasons: [], milestones: [ms("created", T), ...["published", "first_offer", "first_accepted", "filled", "started", "loaded", "first_delivery", "closed"].map((k) => ms(k, null))],
      map: { pickup: null, points: [], located: 0, unlocated: 0 }, funnel: { offered: 0, accepted: 0, arrived: 0, attendance: 0, loaded: 0, delivered: 0, cancelled: 0, noShow: 0, replaced: 0, rejected: 0, expired: 0 }, parcelMix: { pending: 0, loaded: 0, delivered: 0, failed: 0, returned: 0, missing: 0, cancelled: 0 }, delivery: { n: 0, p50: null, p90: null, edges: [], buckets: [] } });
    const html = render(inOrder(h(OrderOverview), empty));
    expect(html).toContain("dv1-alerts-clear"); expect(html).not.toMatch(/NaN|undefined|dv1\./);
    fx["/admin/requests/r1/offers"] = { request: { id: "r1", ref: "R", status: "published", service: "delivery_driver", startsAt: T, businessId: "b1", pickup: null }, sensitive: false, manifest: true, items: [] };
    const none = render(inOrder(h(OrderDrivers), empty));
    expect(none).toContain(en["req.no_drivers"]);
    fx["/admin/shipments/p1/detail"] = { ...detail, parcel: { ...detail.parcel, status: "pending", failReason: null, hasProof: false }, journey: [], attempts: [], media: [], messages: { stats: {}, items: [] }, location: { pin: null, delivered: null, deliveredHidden: true, distanceM: null, geoSource: null, sensitive: false }, cod: { dueCents: 0, collectedCents: null, collectedAt: null, collectedBy: null, offer: null, remittances: [] }, route: { stopOrder: null, plannedDistanceM: null, plannedDurationS: null, actualLegS: null, provider: null, plannedAt: null, manual: false, dwellS: null }, partner: null, offer: null, similar: { byPhone: [], byAddress: [] } };
    const bare = render(h(ParcelView, { id: "p1" }));
    expect(bare).toContain(en["dv1.journey_none"]); expect(bare).toContain(en["dv1.evidence_none"]); expect(bare).toContain(en["dv1.similar_none"]); expect(bare).not.toMatch(/NaN|undefined|dv1\./);
  });
  it("escapes chat text (a message is data, never markup)", () => {
    const html = render(inOrder(h(OrderComms)));
    expect(html).toContain("Hello &lt;b&gt;x&lt;/b&gt;"); expect(html).not.toContain("<b>x</b>");
  });
});
