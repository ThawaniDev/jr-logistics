import { describe, it, expect, vi } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/components/layout/auth-context";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";
import { listAdapters } from "@/server/partners/registry";
import { JR_EVENTS, EVENT_KINDS, POLL_CHOICES } from "@/server/partners/types";
import type { Connection, Provider } from "@/components/features/business-shipments-partner";

/**
 * Render smoke test of the connection screens (company portal and staff console): every tab of a carrier (Omniful), a carrier with the token in
 * the URL (Fastcoo), merchant systems with and without a status vocabulary (Shipox, LogesTech, Fizzpa) and the custom webhook, the "shown once"
 * card, the add dialog and the staff list, in English, Arabic and Urdu, with API-shaped fixtures (no browser, no database).
 */
const fx: Record<string, unknown> = {};
vi.mock("@/components/ui/data", () => ({
  useApi: (path: string | null) => { const k = path ? Object.keys(fx).sort((a, b) => b.length - a.length).find((p) => path.startsWith(p)) : undefined; return { data: k ? fx[k] : undefined, error: undefined, mutate: async () => {}, isLoading: false, isValidating: false }; },
  useUrlState: (_k: string, initial = "") => [initial, () => {}], useUrlPatch: () => () => {},
}));
vi.mock("swr", () => ({ default: () => ({ data: { total: 2, active: 2, problems: 0, stuck: 0, stuckCapped: false, providers: [] }, isValidating: false, mutate: async () => {} }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/business/integrations/c1/sync", useRouter: () => ({ replace() {}, push() {} }), useSearchParams: () => new URLSearchParams(""), useParams: () => ({ id: "c1" }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: Record<string, unknown> & { children?: unknown }) => h("a", { href: href as string, ...p }, children as never) }));

import { ConnectionShell, SetupTab } from "@/components/features/partner-conn-detail";
import { SyncTab } from "@/components/features/partner-conn-sync";
import { ActivityTab, FailedTab } from "@/components/features/partner-conn-activity";
import { FreshTokenCard } from "@/components/features/partner-conn-fresh";
import { AddConnectionDialog } from "@/components/features/partner-conn-add";
import { IntegrationsConsole } from "@/components/features/admin-system-integrations";
import { BUSINESS_SCOPE, adminScope, type ConnScope } from "@/components/features/partner-conn-lib";

const DICT = { en, ar, ur };
const T = "2026-11-19T08:00:00.000Z";
const user = (permissions: string[] = [], role = "admin") => ({ id: "u", role, name: "Admin", permissions } as never);
const render = (el: ReactElement, locale: Locale = "en", u = user()) => renderToStaticMarkup(h(AuthProvider, { user: u, children: h(I18nProvider, { locale, dict: DICT[locale], fallback: en, children: el }) }));

// The catalogue as GET /integrations/providers builds it (service.providerCatalog), from the real adapters.
const providers: Provider[] = listAdapters().map((a) => ({
  key: a.key, label: a.label, description: a.description, docsUrl: a.docsUrl ?? null, fields: a.fields as Provider["fields"], capabilities: a.capabilities, inboundTokenHeaders: a.inboundTokenHeaders,
  defaults: { sync: a.defaults?.sync ?? {}, statusOut: a.defaults?.statusOut ?? {}, importNew: a.capabilities.mode === "carrier" ? true : a.defaults?.importNew ?? false, pollMinutes: a.defaults?.pollMinutes ?? 0 },
  statusOut: a.statusOut ?? [], statusIn: a.statusIn ?? [], pollChoices: a.pollOrders || a.track ? [...POLL_CHOICES] : [], events: [...JR_EVENTS], kinds: [...EVENT_KINDS],
}));
const prov = (k: string) => providers.find((p) => p.key === k)!;
/** A connection as viewConnection() shapes it. */
function conn(k: string, o: Partial<Connection> = {}): Connection {
  const p = prov(k); const caps = p.capabilities;
  const statusMap = Object.fromEntries(caps.push.map((ev) => [ev, p.defaults.statusOut[ev] ?? null]));
  return {
    id: "c1", provider: k, providerLabel: p.label, name: `My ${p.label}`, status: "active", mode: caps.mode, config: Object.fromEntries(p.fields.filter((f) => !f.secret).map((f) => [f.key, f.default ?? ""])),
    hasSecret: Object.fromEntries(p.fields.filter((f) => f.secret).map((f) => [f.key, true])),
    settings: { autoCancel: true, importNew: p.defaults.importNew, pollMinutes: p.defaults.pollMinutes, sync: { ...p.defaults.sync }, statusOut: {}, statusIn: {} }, statusMap,
    statusInOptions: p.statusIn.map((s) => ({ value: s.value, label: s.label, labelAr: null, kind: s.kind })), statusOutOptions: p.statusOut, capabilities: caps,
    webhookUrl: caps.webhookIn ? "https://jr.test/api/v1/integrations/hooks/c1" : null, webhookAuth: caps.webhookAuth, webhookUrlTemplate: caps.webhookIn ? (caps.webhookAuth === "url" ? "https://jr.test/api/v1/integrations/hooks/c1/{token}" : "https://jr.test/api/v1/integrations/hooks/c1") : null,
    tokenPrefix: "jrh_abcd", carrier: caps.carrierApi ? { baseUrl: `https://jr.test/api/v1/carriers/${k}`, clientId: "c1", authModes: ["api_key", "access_token"] } : null,
    runtime: { webhookRegistered: false, webhookHost: null, webhookRegisteredAt: null, lastCarrierCallAt: null, authMode: null, lastOrderPollAt: null, statusCatalogAt: null },
    lastCheckedAt: T, lastOkAt: T, lastError: null, lastEventAt: T, lastPollAt: null, createdAt: T, updatedAt: T, orders: { open: 3, inJr: 1 }, ...o,
  };
}
fx["/integrations/connections/c1/outbox"] = { counts: { sent: 4, dead: 1 }, problems: [{ id: "ob1", action: "picked_up", status: "dead", attempts: 6, lastError: "timeout", code: "JR-1", createdAt: T }, { id: "ob2", action: "cancelled", status: "skipped", attempts: 0, lastError: null, code: null, createdAt: T }] };
fx["/admin/integrations/connections/c1/outbox"] = fx["/integrations/connections/c1/outbox"];
fx["/integrations/connections/c1/events"] = { items: [{ id: "e1", direction: "poll", kind: "status", outcome: "ok", summary: "2 checked", externalId: "X1", shipmentId: null, requestId: "r1", createdAt: T }, { id: "e2", direction: "in", kind: "cancelled", outcome: "error", summary: null, externalId: null, shipmentId: null, requestId: null, createdAt: T }], page: 1, pageSize: 20, total: 2 };
fx["/admin/integrations/connections/c1/events"] = fx["/integrations/connections/c1/events"];

const inShell = (c: Connection, child: ReactElement, scope: ConnScope = BUSINESS_SCOPE) => h(ConnectionShell, { scope, conn: c, providers, reload: async () => {}, onFresh: () => {}, children: child });
const clean = (html: string) => { expect(html).not.toMatch(/\b(iv2|intg|pa|rdz)\.[a-z_]+/); expect(html).not.toContain("undefined"); expect(html).not.toContain("NaN"); expect(html).not.toContain("[object Object]"); };

const CASES: Array<[string, () => Connection]> = [
  ["omniful", () => conn("omniful", { settings: { ...conn("omniful").settings, statusOut: { delivered: "", picked_up: "in_transit" } } })],
  ["fastcoo", () => conn("fastcoo")],
  ["shipox", () => conn("shipox", { settings: { ...conn("shipox").settings, statusIn: { delivered_custom: "delivered" } } })],
  ["logestechs", () => conn("logestechs", { statusInOptions: [{ value: "DELIVERED_TO_RECIPIENT", label: "Delivered", labelAr: "تم التسليم", kind: "delivered" }], runtime: { ...conn("logestechs").runtime, statusCatalogAt: T, webhookRegistered: true, webhookRegisteredAt: T } })],
  ["fizzpa", () => conn("fizzpa")],
  ["webhook", () => conn("webhook")],
];

describe("connection screens render", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    for (const [key, make] of CASES) {
      it(`${key} (${locale}): header, setup, sync, activity and failed updates render with no raw keys`, () => {
        const c = make();
        for (const tab of [SetupTab, SyncTab, ActivityTab, FailedTab]) clean(render(inShell(c, h(tab)), locale));
      });
    }
  }

  it("header: mode badge + explanation, tabs incl. Sync & statuses and the Orders link with the open count", () => {
    const html = render(inShell(conn("omniful"), h(SetupTab)));
    expect(html).toContain('data-mode="carrier"'); expect(html).toContain("JR reports every status back");
    for (const href of ["/business/integrations/c1", "/business/integrations/c1/sync", "/business/integrations/orders?connectionId=c1", "/business/integrations/c1/activity", "/business/integrations/c1/failed"]) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain("test-connection"); expect(html).not.toContain("conn-view-only");
  });
  it("carrier setup: base URL + client ID to copy, the two auth modes, what JR saw; no Check now (Omniful cannot be asked)", () => {
    const html = render(inShell(conn("omniful", { runtime: { ...conn("omniful").runtime, webhookRegistered: true, webhookHost: "api.omniful.tech", webhookRegisteredAt: T, lastCarrierCallAt: T, authMode: "access_token" } }), h(SetupTab)));
    for (const id of ["carrier-section", "carrier-base-url", "carrier-client-id", "carrier-auth-modes", "carrier-runtime", "rotate-token"]) expect(html, id).toContain(`data-testid="${id}"`);
    expect(html).toContain("https://jr.test/api/v1/carriers/omniful"); expect(html).toContain("api.omniful.tech"); expect(html).toContain("access_token");
    expect(html).not.toContain("poll-now");
  });
  it("url-auth setup (Fastcoo): the address pattern, shown-once note and the documented path suffix", () => {
    const html = render(inShell(conn("fastcoo"), h(SetupTab)));
    expect(html).toContain('data-testid="webhook-url-template"'); expect(html).toContain("/hooks/c1/{token}"); expect(html).toContain("/webhook/API/OrderRecieveLM");
    expect(html).toContain("advanced-toggle"); expect(html).not.toContain('data-testid="field-statusPath"'); // advanced fields start collapsed
  });
  it("merchant setup with track: Check now; LogesTech keeps Connect automatically", () => {
    const html = render(inShell(conn("logestechs"), h(SetupTab)));
    expect(html).toContain("poll-now"); expect(html).toContain("connect-auto-detail");
  });
  it("sync, carrier with a vocabulary: one row per pushable event, status select with default / don't send / codes, effective value", () => {
    const html = render(inShell(conn("omniful", { settings: { ...conn("omniful").settings, statusOut: { delivered: "", picked_up: "in_transit" } } }), h(SyncTab)));
    for (const ev of prov("omniful").capabilities.push) { expect(html, ev).toContain(`data-testid="out-row-${ev}"`); expect(html, ev).toContain(`data-testid="set-sync-${ev}"`); expect(html, ev).toContain(`data-testid="status-out-${ev}"`); }
    expect(html).not.toContain('data-testid="out-row-accepted"');
    expect(html).toContain("Documented default (Dispatched)"); expect(html).toContain("Don&#x27;t send"); expect(html).toContain("in_transit");
    expect(html).toContain("import-always"); expect(html).toContain("set-autoCancel"); expect(html).not.toContain("set-importNew"); expect(html).not.toContain("set-pollMinutes");
    expect(html).toContain("in-api-only"); expect(html).not.toContain("status-in-new-key"); // Omniful cancels through the API; it sends no status strings
  });
  it("sync, merchant without a vocabulary (LogesTech): switches only, with the real-action warning; catalogue labels in Arabic", () => {
    const c = CASES.find(([k]) => k === "logestechs")![1]();
    const html = render(inShell(c, h(SyncTab)));
    expect(html).toContain("set-sync-cancelled"); expect(html).toContain("set-sync-returned"); expect(html).not.toContain("status-out-cancelled");
    expect(html).toContain("These are real actions"); expect(html).toContain("set-importNew"); expect(html).toContain("set-pollMinutes");
    expect(render(inShell(c, h(SyncTab)), "ar")).toContain("تم التسليم");
  });
  it("sync, inbound: documented statuses, the connection's own keys and the add-a-key row", () => {
    const html = render(inShell(CASES.find(([k]) => k === "shipox")![1](), h(SyncTab)));
    for (const id of ["in-row-unassigned", "in-row-cancelled", "in-row-delivered_custom", "status-in-remove-delivered_custom", "status-in-new-key", "status-in-add", "save-inbound"]) expect(html, id).toContain(`data-testid="${id}"`);
    expect(render(inShell(conn("fizzpa"), h(SyncTab)))).toContain('data-testid="in-none"');
  });
  it("activity: direction filter and the poll line; failed updates name v2 events", () => {
    const html = render(inShell(conn("omniful"), h(ActivityTab)));
    expect(html).toContain('aria-label="Direction"'); expect(html).toContain("Check of Omniful"); expect(html).toContain('href="/business/requests/r1"');
    expect(render(inShell(conn("omniful"), h(FailedTab)))).toContain("Send “Picked up” to Omniful");
  });
  it("staff without integrations.manage: everything visible, nothing changeable; requests open in the console", () => {
    const c = conn("omniful", { business: "Alpha Foods", businessId: "b1" });
    const html = render(inShell(c, h(SyncTab), adminScope(false)));
    expect(html).toContain("conn-view-only"); expect(html).toContain('href="/admin/companies/b1"'); expect(html).toContain("Alpha Foods");
    expect(html).not.toContain("test-connection"); expect(html).not.toContain("delete-connection"); expect(html).not.toContain("save-outbound");
    expect(html).toMatch(/data-testid="set-sync-picked_up"[^>]*disabled|disabled[^>]*data-testid="set-sync-picked_up"/);
    expect(render(inShell(c, h(ActivityTab), adminScope(false)))).toContain('href="/admin/requests/r1"');
    expect(render(inShell(c, h(SetupTab), adminScope(false)))).not.toContain("rotate-token");
  });
});

describe("shown once, add dialog, staff list", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    it(`fresh credentials (${locale}): carrier, token in the URL, header token with automatic set-up`, () => {
      const carrier = render(h(FreshTokenCard, { fresh: { conn: conn("omniful"), creds: { inboundToken: "jrh_K", webhookUrl: null, carrier: { baseUrl: "https://jr.test/api/v1/carriers/omniful", apiKey: "jrh_K", clientId: "c1", clientSecret: "jrh_K" } }, kind: "created" }, provider: prov("omniful"), scope: BUSINESS_SCOPE, onDone: () => {}, onChanged: () => {} }), locale);
      for (const id of ["fresh-carrier", "fresh-base-url", "fresh-api-key", "fresh-client-id", "fresh-client-secret", "carrier-auth-modes", "token-saved"]) expect(carrier, id).toContain(`data-testid="${id}"`);
      clean(carrier);
      const url = render(h(FreshTokenCard, { fresh: { conn: conn("shipox"), creds: { inboundToken: "jrh_U", webhookUrl: "https://jr.test/api/v1/integrations/hooks/c1/jrh_U", carrier: null }, kind: "rotated" }, provider: prov("shipox"), scope: BUSINESS_SCOPE, onDone: () => {}, onChanged: () => {} }), locale);
      expect(url).toContain("fresh-webhook-url-auth"); expect(url).toContain("/hooks/c1/jrh_U"); clean(url);
      const hdr = render(h(FreshTokenCard, { fresh: { conn: conn("logestechs"), creds: { inboundToken: "jrh_H", webhookUrl: "https://jr.test/api/v1/integrations/hooks/c1", carrier: null }, kind: "created" }, provider: prov("logestechs"), scope: BUSINESS_SCOPE, onDone: () => {}, onChanged: () => {} }), locale);
      expect(hdr).toContain("connect-auto"); expect(hdr).toContain('data-testid="inbound-token"'); clean(hdr);
    });
    it(`add dialog (${locale}): systems grouped by mode; staff start with the company`, () => {
      const html = render(h(AddConnectionDialog, { providers, scope: BUSINESS_SCOPE, onClose: () => {}, onCreated: () => {} }), locale);
      for (const m of ["carrier", "merchant", "custom"]) expect(html, m).toContain(`data-testid="provider-group-${m}"`);
      for (const p of providers) expect(html, p.key).toContain(`data-testid="provider-${p.key}"`);
      clean(html);
      fx["/admin/companies"] = { items: [{ id: "b1", name: "Alpha Foods", contactName: "Sara", city: "riyadh", email: "a@x.test", verificationStatus: "verified" }], total: 1 };
      const staff = render(h(AddConnectionDialog, { providers, scope: adminScope(true), pickCompany: true, onClose: () => {}, onCreated: () => {} }), locale);
      expect(staff).toContain("add-company-step"); expect(staff).toContain('data-company-id="b1"'); clean(staff);
    });
  }
  it("staff list: rows open the connection, mode badge, add button only with integrations.manage", () => {
    fx["/admin/partners"] = { items: [{ ...conn("omniful"), business: "Alpha Foods", businessId: "b1", stuckUpdates: 0 }], total: 1 };
    const html = render(h(IntegrationsConsole));
    expect(html).toContain('href="/admin/integrations/c1"'); expect(html).toContain('data-testid="int-open-c1"'); expect(html).toContain('data-mode="carrier"');
    expect(html).toContain("admin-add-connection"); clean(html);
    const viewer = render(h(IntegrationsConsole), "en", user(["integrations.view"], "staff"));
    expect(viewer).not.toContain("admin-add-connection"); expect(viewer).toContain('href="/admin/integrations/c1"');
    const legacy = render(h(IntegrationsConsole), "en", user(["requests.view"], "staff"));
    expect(legacy).toContain('href="/admin/integrations/c1"');
  });
});
