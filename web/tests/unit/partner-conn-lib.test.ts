import { describe, expect, it } from "vitest";
import type { Capabilities, Connection, Provider } from "@/components/features/business-shipments-partner";
import {
  BUSINESS_SCOPE, EMPTY_OUT, OUT_DEFAULT, OUT_NONE, adminScope, advancedHasError, canPoll, checkNewKey, connApi, connRoute, decodeOut, effectiveOut, encodeOut, groupByMode,
  importChoice, inPatch, inRows, modeOf, ordersHref, outOptions, outPatch, outRows, pollOptions, splitCreated, splitFields, urlCarriesToken,
} from "@/components/features/partner-conn-lib";

const caps = (o: Partial<Capabilities> = {}): Capabilities => ({
  mode: "carrier", lookup: false, webhookIn: false, webhookAuth: "header", registerWebhook: false, importOrders: true, pollOrders: false, track: false,
  push: ["picked_up", "delivered", "failed"], label: false, carrierApi: true, ...o,
});
const provider = (o: Partial<Provider> = {}): Provider => ({
  key: "omniful", label: "Omniful", description: "", docsUrl: null, fields: [], capabilities: caps(), inboundTokenHeaders: [],
  defaults: { sync: { picked_up: true, delivered: true }, statusOut: { picked_up: "dispatched", delivered: "delivered", failed: "unable_to_deliver" }, importNew: true, pollMinutes: 0 },
  statusOut: [{ value: "dispatched", label: "Dispatched" }, { value: "delivered", label: "Delivered" }, { value: "unable_to_deliver", label: "Unable to deliver" }],
  statusIn: [], pollChoices: [], events: [], kinds: [], ...o,
});
const conn = (o: Partial<Connection> = {}, settings: Partial<Connection["settings"]> = {}): Connection => ({
  id: "c1", provider: "omniful", providerLabel: "Omniful", name: "Main", status: "active", mode: "carrier", config: {}, hasSecret: {},
  settings: { autoCancel: true, importNew: true, pollMinutes: 0, sync: { picked_up: true, delivered: true }, statusOut: {}, statusIn: {}, ...settings },
  statusMap: {}, statusInOptions: [], statusOutOptions: provider().statusOut, capabilities: caps(), webhookUrl: null, webhookAuth: "header", webhookUrlTemplate: null,
  tokenPrefix: "jrh_abcd", carrier: { baseUrl: "https://jr.test/api/v1/carriers/omniful", clientId: "c1", authModes: ["api_key", "access_token"] },
  runtime: { webhookRegistered: false, webhookHost: null, webhookRegisteredAt: null, lastCarrierCallAt: null, authMode: null, lastOrderPollAt: null, statusCatalogAt: null },
  lastCheckedAt: null, lastOkAt: null, lastError: null, lastEventAt: null, lastPollAt: null, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", ...o,
});

describe("scope paths", () => {
  it("company and staff use their own API and route prefixes", () => {
    expect(connApi(BUSINESS_SCOPE, "x", "/poll")).toBe("/integrations/connections/x/poll");
    expect(connApi(adminScope(true), "x")).toBe("/admin/integrations/connections/x");
    expect(connRoute(adminScope(false), "x", "/sync")).toBe("/admin/integrations/x/sync");
    expect(ordersHref(BUSINESS_SCOPE, "a b")).toBe("/business/integrations/orders?connectionId=a%20b");
    expect(adminScope(false).canManage).toBe(false);
    expect(BUSINESS_SCOPE.canManage).toBe(true);
  });
});

describe("modes and capabilities", () => {
  it("groups providers carrier → merchant → custom and drops empty groups", () => {
    const ps = [provider({ key: "a", capabilities: caps({ mode: "merchant" }) }), provider({ key: "b" }), provider({ key: "c", capabilities: caps({ mode: "merchant" }) })];
    expect(groupByMode(ps).map((g) => [g.mode, g.items.map((p) => p.key)])).toEqual([["carrier", ["b"]], ["merchant", ["a", "c"]]]);
  });
  it("mode falls back to the capabilities; Check now needs pollOrders or track", () => {
    expect(modeOf(conn({ mode: null, capabilities: caps({ mode: "merchant" }) }))).toBe("merchant");
    expect(modeOf(conn({ mode: null, capabilities: null }))).toBeNull();
    expect(canPoll(caps())).toBe(false);
    expect(canPoll(caps({ track: true }))).toBe(true);
    expect(canPoll(null)).toBe(false);
  });
  it("import: carrier always, merchant / custom toggle when the system can send orders", () => {
    expect(importChoice(conn())).toBe("always");
    expect(importChoice(conn({ mode: "merchant", capabilities: caps({ mode: "merchant", importOrders: true }) }))).toBe("toggle");
    expect(importChoice(conn({ mode: "merchant", capabilities: caps({ mode: "merchant", importOrders: false }) }))).toBe("none");
  });
  it("poll options keep an unusual saved value selectable", () => {
    expect(pollOptions(provider({ pollChoices: [0, 15, 30] }), 30)).toEqual([0, 15, 30]);
    expect(pollOptions(provider({ pollChoices: [0, 15, 30] }), 45)).toEqual([0, 15, 30, 45]);
    expect(pollOptions(provider({ pollChoices: [] }), 0)).toEqual([]);
  });
});

describe("form fields", () => {
  const fields = [{ key: "apiKey" }, { key: "baseUrl", advanced: true }, { key: "timezone", advanced: true }];
  it("advanced fields are split off and open when one has an error", () => {
    expect(splitFields(fields).basic.map((f) => f.key)).toEqual(["apiKey"]);
    expect(splitFields(fields).advanced.map((f) => f.key)).toEqual(["baseUrl", "timezone"]);
    expect(advancedHasError(fields, { apiKey: "x" })).toBe(false);
    expect(advancedHasError(fields, { timezone: "x" })).toBe(true);
  });
});

describe("outbound mapping", () => {
  it("select value ⇄ setting: default = null, don't send = \"\", code = code", () => {
    expect(encodeOut(undefined)).toBe(OUT_DEFAULT); expect(encodeOut(null)).toBe(OUT_DEFAULT); expect(encodeOut("")).toBe(OUT_NONE); expect(encodeOut("lost")).toBe("lost");
    expect(decodeOut(OUT_DEFAULT)).toBeNull(); expect(decodeOut(OUT_NONE)).toBe(""); expect(decodeOut("lost")).toBe("lost");
    expect(effectiveOut(null, "dispatched")).toBe("dispatched"); expect(effectiveOut("", "dispatched")).toBeNull(); expect(effectiveOut("x", "dispatched")).toBe("x"); expect(effectiveOut(undefined, null)).toBeNull();
  });
  it("rows follow capabilities.push with saved values, defaults and the effective status", () => {
    const c = conn({}, { statusOut: { delivered: "" } });
    const rows = outRows(c, provider(), EMPTY_OUT);
    expect(rows.map((r) => [r.ev, r.sync, r.choice, r.effective, r.changed])).toEqual([
      ["picked_up", true, null, "dispatched", false],
      ["delivered", true, "", null, false],
      ["failed", false, null, "unable_to_deliver", false],
    ]);
  });
  it("the patch holds only what differs from what is saved", () => {
    const c = conn({}, { statusOut: { delivered: "" } });
    expect(outPatch(c, EMPTY_OUT)).toBeNull();
    expect(outPatch(c, { sync: { picked_up: true }, statusOut: { delivered: "" } })).toBeNull(); // same as saved
    expect(outPatch(c, { sync: { failed: true }, statusOut: { picked_up: "", delivered: null } })).toEqual({ sync: { failed: true }, statusOut: { picked_up: "", delivered: null } });
    const rows = outRows(c, provider(), { sync: {}, statusOut: { picked_up: "delivered" } });
    expect(rows[0]).toMatchObject({ choice: "delivered", effective: "delivered", changed: true });
  });
  it("events the system cannot hear are never in the patch", () => {
    const c = conn();
    expect(outPatch(c, { sync: { accepted: true }, statusOut: { accepted: "x" } })).toBeNull();
  });
  it("a saved code outside the documented list stays selectable", () => {
    const c = conn({}, { statusOut: { picked_up: "custom_code" } });
    expect(outOptions(c, outRows(c, provider(), EMPTY_OUT)).map((o) => o.value)).toEqual(["dispatched", "delivered", "unable_to_deliver", "custom_code"]);
  });
});

describe("inbound mapping", () => {
  const p = provider({ key: "fastcoo", statusIn: [{ value: "CCR", label: "Cancelled", kind: "cancelled" }, { value: "POD", label: "Delivered", kind: "delivered" }] });
  const opts = [{ value: "CCR", label: "Cancelled", labelAr: null, kind: "cancelled" as const }, { value: "POD", label: "Delivered", labelAr: null, kind: "delivered" as const }, { value: "OD", label: "Out", labelAr: "خرجت", kind: "status" as const }];
  it("documented statuses first, then the connection's own keys, then draft keys", () => {
    const c = conn({ statusInOptions: opts }, { statusIn: { "x-lost": "failed" } });
    const rows = inRows(c, p, { "new key": "returned" });
    expect(rows.map((r) => [r.key, r.kind, r.documented, r.custom, r.changed])).toEqual([
      ["ccr", "cancelled", "cancelled", false, false], ["pod", "delivered", "delivered", false, false], ["od", "status", null, false, false],
      ["x-lost", "failed", null, true, false], ["new key", "returned", null, true, true],
    ]);
  });
  it("patch: changed meanings, null for a documented status set back to its documented meaning, null for a removed custom key", () => {
    const c = conn({ statusInOptions: [{ ...opts[0], kind: "status" }, opts[1], opts[2]] }, { statusIn: { ccr: "status", "x-lost": "failed" } });
    expect(inPatch(c, p, {})).toBeNull();
    expect(inPatch(c, p, { ccr: "cancelled", od: "delivered", "x-lost": null, brand: "cancelled" })).toEqual({ ccr: null, od: "delivered", "x-lost": null, brand: "cancelled" });
    expect(inRows(c, p, { "x-lost": null }).find((r) => r.key === "x-lost")).toMatchObject({ removed: true, changed: true });
  });
  it("new keys: trimmed, lower-cased, at most 80 characters, not already listed", () => {
    const rows = [{ key: "pod", removed: false }, { key: "gone", removed: true }];
    expect(checkNewKey("  ", rows)).toBe("empty");
    expect(checkNewKey("x".repeat(81), rows)).toBe("too_long");
    expect(checkNewKey(" POD ", rows)).toBe("exists");
    expect(checkNewKey("GONE", rows)).toBeNull();
    expect(checkNewKey("RTC", rows)).toBeNull();
  });
});

describe("credentials shown once", () => {
  it("splits a carrier create answer into the connection and the credentials", () => {
    const { carrier: _c, ...base } = conn();
    const r = { ...base, inboundToken: "jrh_tok", webhookUrl: null, carrier: { baseUrl: "https://jr.test/api/v1/carriers/omniful", apiKey: "jrh_tok", clientId: "c1", clientSecret: "jrh_tok" } };
    const { conn: c, creds } = splitCreated(r);
    expect(creds).toEqual({ inboundToken: "jrh_tok", webhookUrl: null, carrier: r.carrier });
    expect(c.carrier).toEqual({ baseUrl: r.carrier.baseUrl, clientId: "c1", authModes: ["api_key", "access_token"] });
    expect("inboundToken" in c).toBe(false);
  });
  it("url-auth: the full address carries the token; the connection keeps the base address", () => {
    const { carrier: _c, ...base } = conn({ mode: "merchant", webhookAuth: "url" });
    const { conn: c, creds } = splitCreated({ ...base, carrier: null, inboundToken: "jrh_t1", webhookUrl: "https://jr.test/api/v1/integrations/hooks/c1/jrh_t1" });
    expect(creds?.webhookUrl).toBe("https://jr.test/api/v1/integrations/hooks/c1/jrh_t1");
    expect(c.webhookUrl).toBe("https://jr.test/api/v1/integrations/hooks/c1");
    expect(urlCarriesToken(creds!)).toBe(true);
    expect(urlCarriesToken({ inboundToken: "jrh_t1", webhookUrl: "https://jr.test/api/v1/integrations/hooks/c1" })).toBe(false);
  });
  it("systems without JR credentials hand nothing over", () => {
    const { carrier: _c, ...base } = conn({ mode: "merchant" });
    expect(splitCreated({ ...base, carrier: null, inboundToken: null, webhookUrl: null }).creds).toBeNull();
  });
});
