import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/en";
import ar from "@/i18n/ar";

/** The drivers section of a company's order draws its buttons from `offer.actions[]`: a CANCELLED offer with parcels still on board must offer "confirm returns" (audit K / A3 + A5). */
vi.mock("@/components/ui/data", () => ({ useApi: () => ({ data: undefined, error: undefined, mutate: () => {}, isLoading: false }), useUrlState: (_k: string, i = "") => [i, () => {}], useUrlPatch: () => () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/business/requests/r1", useRouter: () => ({ replace() {}, push() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: Record<string, unknown> & { children?: unknown }) => h("a", { href: href as string, ...p }, children as never) }));
vi.mock("@/components/features/business-custody", () => ({ OfferCustody: () => null }));

import { RequestProvider, type RequestCtx } from "@/components/features/business-views-request-ctx";
import { DriversSection } from "@/components/features/business-views-request-drivers";

const offer = (id: string, status: string, actions: string[]) => ({
  id, status, actions, isReplacement: false, expectedUnits: 5, loadedUnits: 5, deliveredUnits: 2, finalUnits: null, routeApprovedAt: null, loading: null, cod: null,
  driver: { id: "d" + id, name: "Driver " + id, phone: "+966500000011", vehicleType: "van", rating: 4.5, jobsCompleted: 12 },
  parcels: { total: 5, delivered: 2, failed: 3, loaded: 0, pending: 0, returned: 0, missing: 0 },
});
const ctx = (offers: ReturnType<typeof offer>[]): RequestCtx => ({
  id: "r1", base: "/business/requests/r1", data: { offeredCount: 0, offers }, r: { id: "r1", ref: "JR-000001", status: "cancelled", quantity: 2, slotsFilled: 2 }, offers, manifest: true, ship: undefined,
  incomplete: 0, undelivered: 3, live: false, blocked: false, cat: {}, mutate: () => {}, refreshShipments: async () => {}, open: () => {}, act: () => {}, busy: () => false, openReport: () => {}, openComplete: () => {},
} as unknown as RequestCtx);
const render = (offers: ReturnType<typeof offer>[], locale: "en" | "ar" = "en") =>
  renderToStaticMarkup(h(I18nProvider, { locale, dict: locale === "en" ? en : ar, fallback: en, children: h(RequestProvider, { value: ctx(offers), children: h(DriversSection) }) }));

describe("business order page: drivers section", () => {
  it("shows the confirm-returns button on a cancelled offer that still has parcels out, and only there", () => {
    const html = render([offer("a", "cancelled", ["confirm_returns"]), offer("b", "cancelled", []), offer("c", "completed", ["rate"])]);
    const cards = html.split('data-testid="driver-card"').slice(1);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain('data-status="cancelled"'); expect(cards[0]).toContain(en["bs.act_confirm_returns"]);
    expect(cards[1]).not.toContain(en["bs.act_confirm_returns"]);
    expect(cards[2]).not.toContain(en["bs.act_confirm_returns"]); expect(cards[2]).toContain(en["act.rate"]);
  });
  it("is translated", () => {
    const html = render([offer("a", "cancelled", ["confirm_returns"])], "ar");
    expect(html).toContain(ar["bs.act_confirm_returns"]); expect(html).not.toContain(en["bs.act_confirm_returns"]);
  });
});
