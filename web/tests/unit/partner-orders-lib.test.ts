import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ORDER_FILTERS, cancelledByKey, canRefresh, cityLabel, cityVerdict, countOf, fromOrdersHref, groupProblems, idsByCity, importableConnections, inManifest, isOpen, isRestorable,
  isSelectable, kgOf, manifestRows, newRowsOnly, ordersPath, parseFilter, parseOrderIds, pickupPairs, prunePicked, refList, seedForm, seedFrom, selectionSummary, togglePicked,
  type ManifestWireRow, type OrdersManifest,
} from "@/components/features/partner-orders-lib";
import { emptyRow, toWire } from "@/components/features/business-shipments-lib";
import * as frag from "@/i18n/fragments/partners-v2-orders";

/** Incoming orders: pure client logic (filters, selection, the request-form hand-over, problem messages). No DB, no network. */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const order = (over: Partial<{ id: string; state: "open" | "in_jr" | "delivered" | "undelivered" | "cancelled"; cancelledBy: string | null; awb: string | null; externalRef: string }>) =>
  ({ id: U(1), state: "open" as const, cancelledBy: null, awb: null, externalRef: "ORD-1", ...over });
const wire = (over: Partial<ManifestWireRow> = {}): ManifestWireRow => ({
  orderId: U(1), recipientType: "consumer", recipientName: "Ali", recipientPhone: "0555000001", address: "Olaya St 1", city: "riyadh", lat: 24.7, lng: 46.6,
  contents: "Shoes", notes: null, externalRef: "W-1", partnerId: U(99), codCents: 2500, codKnown: true, ...over,
});
const manifest = (rows: ManifestWireRow[], over: Partial<OrdersManifest> = {}): OrdersManifest => {
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))] as string[];
  return { rows, problems: [], cities, deliveryCity: cities.length === 1 ? cities[0] : null, cityNames: {}, ...over };
};

describe("list filters", () => {
  it("state pills: open is the default, unknown values fall back to it, 'all' sends no state", () => {
    expect(ORDER_FILTERS).toEqual(["open", "in_jr", "delivered", "undelivered", "cancelled", "all"]);
    expect(parseFilter(null)).toBe("open");
    expect(parseFilter("nonsense")).toBe("open");
    expect(parseFilter("in_jr")).toBe("in_jr");
    expect(ordersPath("/integrations", { state: "all" })).toBe("/integrations/orders");
    expect(ordersPath("/integrations", { state: "open" })).toBe("/integrations/orders?state=open");
  });
  it("builds the query (connection, company, trimmed search, city, page, page size ≤ 200) and leaves blanks out", () => {
    expect(ordersPath("/admin/integrations", { state: "cancelled", connectionId: U(5), businessId: U(6), q: "  0555 ", city: "jeddah", page: 3, pageSize: 999 }))
      .toBe(`/admin/integrations/orders?state=cancelled&connectionId=${U(5)}&businessId=${U(6)}&q=0555&city=jeddah&page=3&pageSize=200`);
    expect(ordersPath("/integrations", { state: "open", connectionId: "", q: "   ", city: "", page: 1 })).toBe("/integrations/orders?state=open");
  });
  it("counts per pill; 'all' is the sum", () => {
    const c = { open: 2, in_jr: 3, delivered: 4, undelivered: 1, cancelled: 5 };
    expect(countOf(c, "open")).toBe(2);
    expect(countOf(c, "all")).toBe(15);
    expect(countOf(undefined, "open")).toBeUndefined();
  });
});

describe("what can be done with an order", () => {
  it("open orders can go into a delivery request or be set aside; only orders set aside by JR / the company can be restored", () => {
    expect(isOpen(order({}))).toBe(true);
    expect(isRestorable(order({ state: "cancelled", cancelledBy: "business" }))).toBe(true);
    expect(isRestorable(order({ state: "cancelled", cancelledBy: "staff" }))).toBe(true);
    expect(isRestorable(order({ state: "cancelled", cancelledBy: "partner" }))).toBe(false);
    expect(isSelectable(order({ state: "in_jr" }))).toBe(false);
    expect(isSelectable(order({ state: "delivered" }))).toBe(false);
  });
  it("splits a selection by action and ignores ids no longer on the page", () => {
    const items = [order({ id: U(1) }), order({ id: U(2), state: "cancelled", cancelledBy: "business" }), order({ id: U(3), state: "cancelled", cancelledBy: "partner" }), order({ id: U(4), state: "in_jr" })];
    const s = selectionSummary(items, new Set([U(1), U(2), U(3), U(9)]));
    expect(s).toEqual({ count: 3, open: [U(1)], restorable: [U(2)] });
    expect([...prunePicked(new Set([U(1), U(3), U(4), U(9)]), items)]).toEqual([U(1)]);
    expect([...togglePicked(new Set([U(1)]), [U(2), U(3)], true)].sort()).toEqual([U(1), U(2), U(3)]);
    expect([...togglePicked(new Set([U(1), U(2)]), [U(1)], false)]).toEqual([U(2)]);
  });
  it("refresh needs lookup or tracking; import needs an active connection that can look orders up", () => {
    const caps = (lookup: boolean, track: boolean) => ({ capabilities: { mode: "merchant" as const, lookup, track, webhookIn: true, webhookAuth: "header" as const, registerWebhook: false, importOrders: true, pollOrders: false, push: [], label: false, carrierApi: false } });
    expect(canRefresh(caps(true, false))).toBe(true);
    expect(canRefresh(caps(false, true))).toBe(true);
    expect(canRefresh(caps(false, false))).toBe(false);
    expect(canRefresh(null)).toBe(false);
    expect(importableConnections([{ status: "active" as const, ...caps(true, false) }, { status: "disabled" as const, ...caps(true, false) }, { status: "active" as const, ...caps(false, true) }, { status: "active" as const, capabilities: null }])).toHaveLength(1);
  });
});

describe("hand-over to the request form", () => {
  it("?fromOrders= keeps uuid-shaped ids only, once each, in order, at most 500", () => {
    expect(parseOrderIds(`${U(2)},${U(1)}, ${U(2)},nope,,${U(3).toUpperCase()}`)).toEqual([U(2), U(1), U(3)]);
    expect(parseOrderIds(null)).toEqual([]);
    expect(parseOrderIds(Array.from({ length: 600 }, (_, i) => U(i + 1)).join(","))).toHaveLength(500);
    expect(fromOrdersHref([U(1), U(2)])).toBe(`/business/requests/new?fromOrders=${U(1)},${U(2)}`);
  });
  it("manifest rows become editor rows: orderId / codKnown dropped, externalRef + partnerId kept, COD in SAR, pins kept", () => {
    const [r] = manifestRows(manifest([wire()]));
    expect(r).toMatchObject({ recipientName: "Ali", recipientPhone: "0555000001", address: "Olaya St 1", externalRef: "W-1", partnerId: U(99), cod: "25", lat: 24.7, lng: 46.6, contents: "Shoes" });
    expect(r).not.toHaveProperty("orderId");
    expect(r).not.toHaveProperty("codKnown");
    // what the form sends: linked to the order, city left to the request
    expect(toWire(r)).toEqual({ recipientType: "consumer", recipientName: "Ali", recipientPhone: "0555000001", address: "Olaya St 1", contents: "Shoes", notes: null, externalRef: "W-1", codCents: 2500, lat: 24.7, lng: 46.6, partnerId: U(99) });
    // COD the partner did not state arrives as 0 → prepaid box
    expect(manifestRows(manifest([wire({ codCents: 0, codKnown: false })]))[0].cod).toBe("");
  });
  it("one city goes through; several cities are refused with the ids per city; no city at all is allowed", () => {
    expect(cityVerdict(manifest([wire(), wire({ orderId: U(2), city: null })]))).toEqual({ kind: "one", city: "riyadh" });
    expect(cityVerdict(manifest([wire({ city: null })]))).toEqual({ kind: "none" });
    const mixed = manifest([wire({ orderId: U(1) }), wire({ orderId: U(2), city: "jeddah" }), wire({ orderId: U(3) }), wire({ orderId: U(4), city: null })]);
    expect(cityVerdict(mixed)).toEqual({ kind: "mixed", cities: ["riyadh", "jeddah"] });
    expect(idsByCity(mixed)).toEqual([{ city: "riyadh", ids: [U(1), U(3)] }, { city: "jeddah", ids: [U(2)] }]);
  });
  it("seed: rows, the orders' city and the delivery service; nothing without a seed", () => {
    const seed = seedFrom(manifest([wire(), wire({ orderId: U(2), externalRef: "W-2" })], { problems: [{ id: U(2), ref: "W-2", issue: "incomplete" }] }));
    expect(seed.orders).toBe(2);
    expect(seed.rows.map((r) => r.externalRef)).toEqual(["W-1", "W-2"]);
    expect(seedForm(seed)).toEqual({ service: "delivery_driver", deliveryCity: "riyadh" });
    expect(seedForm(seedFrom(manifest([wire({ city: null })])))).toEqual({ service: "delivery_driver" });
    expect(seedForm(undefined)).toEqual({});
  });
  it("problems are grouped, most actionable first, refs once each; long lists are cut", () => {
    const g = groupProblems([{ id: "1", ref: "A", issue: "not_open" }, { id: "2", ref: "B", issue: "incomplete" }, { id: "3", ref: "C", issue: "bad_phone" }, { id: "4", ref: "B", issue: "incomplete" }, { id: "5", ref: "D", issue: "no_city" }]);
    expect(g).toEqual([{ issue: "bad_phone", refs: ["C"] }, { issue: "incomplete", refs: ["B"] }, { issue: "no_city", refs: ["D"] }, { issue: "not_open", refs: ["A"] }]);
    expect(refList(["a", "b", "c", "d", "e", "f", "g"])).toEqual({ shown: ["a", "b", "c", "d", "e"], more: 2 });
    expect(refList(["a"])).toEqual({ shown: ["a"], more: 0 });
  });
  it("picker: an order already in the manifest (by its parcel reference, AWB first) is not added twice; room is respected", () => {
    const rows = [emptyRow({ externalRef: "jr00000000001" })];
    expect(inManifest(order({ awb: "JR00000000001", externalRef: "OMN-1" }), rows)).toBe(true);
    expect(inManifest(order({ externalRef: "OMN-2" }), rows)).toBe(false);
    const add = [emptyRow({ externalRef: "JR00000000001" }), emptyRow({ externalRef: "X" }), emptyRow({ externalRef: "x" }), emptyRow({ externalRef: "Y" })];
    expect(newRowsOnly(add, rows, 10).map((r) => r.externalRef)).toEqual(["X", "Y"]);
    expect(newRowsOnly(add, rows, 1).map((r) => r.externalRef)).toEqual(["X"]);
    expect(newRowsOnly(add, rows, 0)).toEqual([]);
  });
});

describe("display helpers", () => {
  const t = (k: string) => ({ "city.riyadh": "الرياض" } as Record<string, string>)[k] ?? k;
  it("city names: translation, then the catalog / server name, then the key", () => {
    expect(cityLabel(t, "riyadh")).toBe("الرياض");
    expect(cityLabel(t, "abha", { abha: "Abha" })).toBe("Abha");
    expect(cityLabel(t, "tabuk")).toBe("tabuk");
  });
  it("weight, who set it aside, pickup details", () => {
    expect(kgOf(1250)).toBe(1.25);
    expect(kgOf(null)).toBeNull();
    expect(cancelledByKey("partner")).toBe("iord.by_partner");
    expect(cancelledByKey("staff")).toBe("iord.by_staff");
    expect(cancelledByKey("business")).toBe("iord.by_business");
    expect(pickupPairs({ name: "WH 1", address: { line1: "Exit 5", city: "Riyadh" }, empty: "", n: 3, list: [1] })).toEqual([{ key: "name", value: "WH 1" }, { key: "address.line1", value: "Exit 5" }, { key: "address.city", value: "Riyadh" }, { key: "n", value: "3" }]);
    expect(pickupPairs(null)).toEqual([]);
  });
});

describe("i18n fragment (iord.*)", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  it("en / ar / ur have exactly the same keys, all prefixed iord., no empty values, same placeholders, Arabic and Urdu actually translated", () => {
    const e = Object.keys(frag.en).sort();
    expect(e.length).toBeGreaterThan(100);
    expect(Object.keys(frag.ar).sort()).toEqual(e);
    expect(Object.keys(frag.ur).sort()).toEqual(e);
    for (const k of e) {
      expect(k.startsWith("iord."), k).toBe(true);
      for (const d of [frag.en, frag.ar, frag.ur]) expect(d[k]?.trim(), k).toBeTruthy();
      expect(placeholders(frag.ar[k]), `ar ${k}`).toBe(placeholders(frag.en[k]));
      expect(placeholders(frag.ur[k]), `ur ${k}`).toBe(placeholders(frag.en[k]));
    }
    for (const k of ["iord.nav", "iord.create_order", "iord.set_aside", "iord.state_open", "iord.dismiss_warn"]) { expect(frag.ar[k]).not.toBe(frag.en[k]); expect(frag.ur[k]).not.toBe(frag.en[k]); }
  });
  it("every iord key the UI uses exists (literal keys and the dynamic families)", () => {
    const dir = join(__dirname, "../../src/components/features");
    const src = readdirSync(dir).filter((f) => f.startsWith("partner-orders") || f === "business-shipments-import.tsx").map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    const used = new Set([...src.matchAll(/"(iord\.[a-z_0-9.]+)"/g)].map((m) => m[1]));
    const families: Record<string, string[]> = {
      state_: ["open", "in_jr", "delivered", "undelivered", "cancelled", "all"], dir_: ["in", "out", "lookup", "test", "poll"], out_: ["ok", "ignored", "error"],
      ob_: ["queued", "sent", "dead", "skipped", "retry_wait"], prob_: ["bad_phone", "incomplete", "no_city", "not_open"],
      ev_: ["accepted", "assigned", "picked_up", "out_for_delivery", "arrived", "delivered", "failed", "postponed", "returned", "missing", "cancelled", "reshipped"],
      kind_: ["order", "status", "cancelled", "delivered", "returned", "failed", "dismissed", "lookup", "test", "poll", "unrecognised", "register_webhook", "auth"],
    };
    for (const [p, vs] of Object.entries(families)) for (const v of vs) used.add(`iord.${p}${v}`);
    expect([...used].filter((k) => !(k in frag.en)).sort()).toEqual([]);
  });
});
