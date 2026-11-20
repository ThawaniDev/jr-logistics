import { describe, it, expect } from "vitest";
import { BitArray, Code128Reader } from "@zxing/library";
import { CODE128, code128Modules, labelPdf, pdfText } from "@/server/partners/label";
import { foldCity, matchCity } from "@/server/partners/cities";
import { issueAccessToken, labelSig, labelSigOk, newAwb, readAccessToken } from "@/server/partners/crypto";
import { shipox, shipoxOrder, classifyShipox } from "@/server/partners/shipox";
import { fizzpaPackage } from "@/server/partners/fizzpa";
import { fastcoo, fastcooDate, fastcooOrder } from "@/server/partners/fastcoo";
import { logestechs, latestHistory, classifyStatus } from "@/server/partners/logestechs";
import { generic } from "@/server/partners/generic";
import { omniful, OMNIFUL_DEFAULT_MAP } from "@/server/partners/omniful";
import { kindFor, settingsOf, statusFor, syncOn } from "@/server/partners/config";
import { asResult } from "@/server/partners/inbound";
import { partnerPhone, orderState } from "@/server/partners/orders-core";
import { listAdapters } from "@/server/partners/registry";
import { JR_EVENTS, type Ctx, type WebhookResult } from "@/server/partners/types";

const ctx = (config: Record<string, string | boolean> = {}): Ctx => ({ connectionId: "c1", config, secrets: {}, meta: {}, http: async () => { throw new Error("no network in unit tests"); }, saveSecrets: async () => {}, saveMeta: async () => {}, lock: (fn) => fn(), reloadSecrets: async () => ({}), appUrl: "https://jr.test" });
const cities = [
  { key: "riyadh", en: "Riyadh", ar: "الرياض", ur: "ریاض", delivery: true }, { key: "jeddah", en: "Jeddah", ar: "جدة", delivery: true },
  { key: "makkah", en: "Makkah", ar: "مكة المكرمة", delivery: true }, { key: "khobar", en: "Khobar", ar: "الخبر", delivery: true }, { key: "madinah", en: "Madinah", ar: "المدينة المنورة", delivery: true },
];

describe("registry: every adapter is internally consistent", () => {
  it("declares only JR events it can push, maps only pushable events, and has unique keys", () => {
    const keys = listAdapters().map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["logestechs", "shipox", "fizzpa", "omniful", "fastcoo", "webhook"]);
    for (const a of listAdapters()) {
      for (const ev of a.capabilities.push) expect(JR_EVENTS).toContain(ev);
      for (const [ev, code] of Object.entries(a.defaults?.statusOut ?? {})) {
        expect(a.capabilities.push).toContain(ev);
        if (a.statusOut?.length) expect(a.statusOut.map((s) => s.value)).toContain(code); // defaults use the vendor's documented vocabulary only
      }
      for (const ev of Object.keys(a.defaults?.sync ?? {})) expect(a.capabilities.push).toContain(ev);
      if (a.capabilities.push.length) expect(a.push).toBeTypeOf("function");
      if (a.capabilities.lookup) expect(a.lookup).toBeTypeOf("function");
      if (a.capabilities.webhookIn) expect(a.parseWebhook).toBeTypeOf("function");
      if (a.capabilities.track) expect(a.track).toBeTypeOf("function");
      if (a.capabilities.pollOrders) expect(a.pollOrders).toBeTypeOf("function");
      if (a.capabilities.label) expect(a.makeLabel).toBeTypeOf("function");
      if (a.capabilities.registerWebhook) expect(a.registerWebhook).toBeTypeOf("function");
      for (const f of a.fields) if (f.type === "select") expect(f.options?.length).toBeGreaterThan(0);
    }
  });
  it("carrier-mode partners always import, merchant-mode ones only when switched on", () => {
    expect(settingsOf({ provider: "omniful", settings: { importNew: false } }).importNew).toBe(true);
    expect(settingsOf({ provider: "fastcoo", settings: {} }).importNew).toBe(true);
    expect(settingsOf({ provider: "logestechs", settings: {} }).importNew).toBe(false);
    expect(settingsOf({ provider: "logestechs", settings: { importNew: true } }).importNew).toBe(true);
    expect(settingsOf({ provider: "logestechs", settings: {} }).pollMinutes).toBe(30); // LogesTech does not retry webhooks → reconcile
    expect(settingsOf({ provider: "fizzpa", settings: {} }).pollMinutes).toBe(30); // no webhooks at all
  });
});

describe("status mapping (editable per connection)", () => {
  it("uses the documented default, a connection's own code, or nothing when blanked", () => {
    expect(statusFor({ provider: "omniful", settings: {} }, omniful, "picked_up")).toBe("dispatched");
    expect(statusFor({ provider: "omniful", settings: {} }, omniful, "failed")).toBe("unable_to_deliver");
    expect(statusFor({ provider: "omniful", settings: {} }, omniful, "arrived")).toBeNull();
    expect(statusFor({ provider: "omniful", settings: { statusOut: { picked_up: "in_transit" } } }, omniful, "picked_up")).toBe("in_transit");
    expect(statusFor({ provider: "omniful", settings: { statusOut: { picked_up: "" } } }, omniful, "picked_up")).toBeNull();
    expect(statusFor({ provider: "fastcoo", settings: {} }, fastcoo, "delivered")).toBe("POD");
    expect(statusFor({ provider: "fastcoo", settings: {} }, fastcoo, "returned")).toBe("ROP");
    expect(OMNIFUL_DEFAULT_MAP.delivered).toBe("delivered");
  });
  it("reads inbound statuses: override → documented list → classifier → plain status", () => {
    expect(kindFor({ provider: "shipox", settings: {} }, shipox, "cancelled")).toBe("cancelled");
    expect(kindFor({ provider: "shipox", settings: {} }, shipox, "completed")).toBe("status"); // not documented → shown only
    expect(kindFor({ provider: "shipox", settings: { statusIn: { Completed: "delivered" } } }, shipox, "completed")).toBe("delivered");
    expect(kindFor({ provider: "logestechs", settings: {} }, logestechs, "CANCELLED_BY_CUSTOMER")).toBe("cancelled");
    expect(kindFor({ provider: "logestechs", settings: { statusIn: { cancelled_by_customer: "status" } } }, logestechs, "CANCELLED_BY_CUSTOMER")).toBe("status");
    expect(kindFor({ provider: "fastcoo", settings: {} }, fastcoo, "CCR")).toBe("cancelled");
  });
  it("only syncs events the adapter supports and the connection wants", () => {
    expect(syncOn({ provider: "omniful", settings: {} }, omniful, "delivered")).toBe(true);
    expect(syncOn({ provider: "omniful", settings: { sync: { delivered: false } } }, omniful, "delivered")).toBe(false);
    expect(syncOn({ provider: "logestechs", settings: { sync: { delivered: true } } }, logestechs, "delivered")).toBe(false); // no such API call
    expect(syncOn({ provider: "logestechs", settings: {} }, logestechs, "cancelled")).toBe(false); // opt-in (decision I3)
  });
});

describe("cities", () => {
  it("matches the usual spellings and never guesses", () => {
    expect(matchCity("Riyadh", cities)).toBe("riyadh");
    expect(matchCity("  RIYADH city ", cities)).toBe("riyadh");
    expect(matchCity("الرياض", cities)).toBe("riyadh");
    expect(matchCity("Jiddah", cities)).toBe("jeddah");
    expect(matchCity("جدة", cities)).toBe("jeddah");
    expect(matchCity("Mecca", cities)).toBe("makkah");
    expect(matchCity("مكة", cities)).toBe("makkah");
    expect(matchCity("Al Khobar", cities)).toBe("khobar");
    expect(matchCity("Al-Madinah Al-Munawwarah", cities)).toBe("madinah");
    expect(matchCity("Dubai", cities)).toBeNull();
    expect(matchCity("", cities)).toBeNull();
    expect(matchCity(null, cities)).toBeNull();
    expect(foldCity("Al Khobar")).toBe(foldCity("Khobar"));
  });
});

describe("phones", () => {
  it("stores E.164 when possible, keeps the raw value otherwise", () => {
    expect(partnerPhone("0555123456")).toEqual({ phone: "+966555123456", valid: true });
    expect(partnerPhone("966555123456")).toEqual({ phone: "+966555123456", valid: true });
    expect(partnerPhone("971112121212")).toEqual({ phone: "+971112121212", valid: true }); // Shipox sample: no plus sign
    expect(partnerPhone("054xxxxxxxxxx")).toEqual({ phone: "054xxxxxxxxxx", valid: false }); // Fastcoo sample (masked)
    expect(partnerPhone("")).toEqual({ phone: null, valid: false });
  });
  it("derives the order state from the live parcel", () => {
    expect(orderState({ state: "open" }, null)).toBe("open");
    expect(orderState({ state: "open" }, { status: "loaded" })).toBe("in_jr");
    expect(orderState({ state: "open" }, { status: "delivered" })).toBe("delivered");
    expect(orderState({ state: "open" }, { status: "returned" })).toBe("undelivered");
    expect(orderState({ state: "cancelled" }, { status: "loaded" })).toBe("cancelled");
  });
});

describe("Code 128 label", () => {
  it("has the 107 standard symbols (11 modules each, stop 13)", () => {
    expect(CODE128).toHaveLength(107);
    CODE128.forEach((p, i) => expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(i === 106 ? 13 : 11));
    expect(new Set(CODE128).size).toBe(107);
  });
  it("encodes an AWB that a real barcode reader decodes back", () => {
    for (const awb of [newAwb(), "JR12345678901", "AWB-123456", "FSL25abc"]) {
      const mods = code128Modules(awb);
      const scale = 3, quiet = 20;
      const row = new BitArray((mods.length + 2 * quiet) * scale);
      mods.forEach((bar, i) => { if (bar) for (let k = 0; k < scale; k++) row.set((quiet + i) * scale + k); });
      expect(new Code128Reader().decodeRow(0, row, new Map()).getText()).toBe(awb);
    }
  });
  it("refuses what Code 128-B cannot encode", () => {
    expect(() => code128Modules("مرحبا")).toThrow();
  });
  it("produces a well-formed one-page PDF whose cross-reference table points at every object", () => {
    const pdf = labelPdf({ awb: "JR12345678901", partner: "Omniful", orderRef: "B2C-1", parcelCode: "JR-000001-001", sender: "Co Test", recipientName: "محمد", recipientPhone: "+966555123456", address: "King Fahd Rd (Gate 2)", city: "Riyadh", codCents: 24575, pieces: 2, weightGrams: 1500, createdAt: new Date("2026-07-15T09:00:00Z") });
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s).toContain("(SAR 245.75)");
    expect(s).toContain("(King Fahd Rd \\(Gate 2\\))"); // escaped parentheses
    expect(s).toContain("(see JR app)"); // Arabic name: not printable with the standard fonts
    expect(pdfText("Ünïcode ok")).toBe("Ünïcode ok");
    expect(pdfText("عربي")).toBeNull();
  });
});

describe("signed links and access tokens", () => {
  it("label links verify, tampering fails", () => {
    const sig = labelSig("JR12345678901");
    expect(labelSigOk("JR12345678901", sig)).toBe(true);
    expect(labelSigOk("jr12345678901", sig)).toBe(true); // case-insensitive AWB
    expect(labelSigOk("JR12345678902", sig)).toBe(false);
    expect(labelSigOk("JR12345678901", sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"))).toBe(false);
  });
  it("access tokens carry connection + version, expire, and cannot be forged", () => {
    const t = issueAccessToken("11111111-1111-1111-1111-111111111111", 3);
    expect(t.expiresIn).toBe(3600);
    expect(readAccessToken(t.token)).toEqual({ connectionId: "11111111-1111-1111-1111-111111111111", version: 3 });
    const [head, sig] = t.token.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "22222222-2222-2222-2222-222222222222", v: 3, e: 9999999999 })).toString("base64url");
    expect(readAccessToken(`jrat_${forged}.${sig}`)).toBeNull();
    expect(readAccessToken(`${head}.x${sig}`)).toBeNull();
    expect(readAccessToken(issueAccessToken("11111111-1111-1111-1111-111111111111", 1, -10).token)).toBeNull();
    expect(readAccessToken("jrh_plainkey")).toBeNull();
  });
  it("AWBs look like JR + 11 digits", () => {
    for (let i = 0; i < 50; i++) expect(newAwb()).toMatch(/^JR[1-9]\d{10}$/);
  });
});

describe("Shipox (samples from the published blueprint)", () => {
  const listItem = {
    locations: [
      { lat: 23.6234493, lon: 53.7325783, city: "Dubai", pickup: true, address: "Apt: 98, Nbhd:, Bldg: Springs, Madinat(Bada) Zayed, 21", contact_name: "TEST ORDER", email: "shipox.test@gmail.com", phone: "9711000000", address_city: "Dubai" },
      { lat: 23.6234493, lon: 53.7325783, city: "Dubai", pickup: false, address: "Apt: 12, Bldg: icon tower, Madinat(Bada) Zayed - Dubai - United Arab Emirates, Madinat(Bada) Zayed, 3232", contact_name: "TEST ORDER", phone: "971112121212", address_city: "Dubai" },
    ],
    id: 171717, order_number: "171717171717", status: "assigned_to_courier", type: "order", created_date: "2020-10-19T08:54:14.866Z", last_status_date: "2020-10-19T08:54:14.952Z",
    amount: 0, payment_type: "cash", charge_items: [{ id: 171717, charge_type: "cod", currency: { code: "AED" }, charge: 0 }, { id: 171718, charge_type: "total", charge: 0 }],
    piece_count: 1, currency: { code: "AED", name: "U.A.E. Dirham" },
  };
  it("reads a customer-orders list item (drop-off = the location with pickup:false)", () => {
    const o = shipoxOrder(listItem)!;
    expect(o).toMatchObject({ externalId: "171717", externalRef: "171717171717", status: "assigned_to_courier", codAmount: 0, pieces: 1, currency: "AED" });
    expect(o.recipient).toMatchObject({ name: "TEST ORDER", phone: "971112121212", city: "Dubai", lat: 23.6234493, lng: 53.7325783 });
    expect(o.recipient.address).toContain("icon tower");
    expect(o.pickup).toMatchObject({ phone: "9711000000" });
    expect(o.statusAt?.toISOString()).toBe("2020-10-19T08:54:14.952Z");
  });
  it("prefers recipient_data from the order details endpoint", () => {
    const o = shipoxOrder({ ...listItem, recipient_data: { name: "Mona", phone: "966555123456", city: { id: 1, name: "Riyadh", code: "riyadh" }, address: "Olaya St", lat: 24.7, lon: 46.6 }, charge_items: [{ charge_type: "cod", charge: 250 }] })!;
    expect(o.recipient).toMatchObject({ name: "Mona", phone: "966555123456", city: "Riyadh", address: "Olaya St", lat: 24.7, lng: 46.6 });
    expect(o.codAmount).toBe(250);
  });
  it("reads the customer webhook (driver phone is never kept)", () => {
    const r = asResult(shipox.parseWebhook!({ order_number: "1111111117", reference_id: "1070171717", status: "accepted", note: "The order 1111111117 was created for test", date: "2020-10-03T14:57:45.058Z", customer_id: 171717, driver: { id: 111777, name: "Aki Ahmed", phone: "+971333333333", email: "test_Aki@gmail.com" } }, ctx(), new Headers()));
    expect(r.events![0]).toMatchObject({ barcode: "1111111117", invoice: "1070171717", status: "accepted", kind: "status", note: "The order 1111111117 was created for test" });
    expect(r.events![0].at.toISOString()).toBe("2020-10-03T14:57:45.058Z");
    expect(JSON.stringify(r)).not.toContain("+971333333333");
    expect(r.orders![0]).toMatchObject({ externalRef: "1111111117", invoice: "1070171717" });
    expect(shipox.parseWebhook!({ status: "accepted" }, ctx(), new Headers())).toBeNull();
    expect(classifyShipox("Cancelled")).toBe("cancelled");
  });
});

describe("Fizzpa (sample from the published blueprint)", () => {
  it("reads GET /orders/{orderid}", () => {
    const p = fizzpaPackage({ OrderId: 15202016, OrderRef: "I-001", OrderNote: "Some Notes", IsDelivered: false, CollectionTypeId: 1, AgentTotal: 100, RecipientName: "test Recipient Name", Phonecode1: 966, Phone1: "00000000", RecipientCityName_En: "Riyadh", RecipientAddress: "test Recipient Address", RecipientLatitude: null, RecipientLongitude: null, PieceCount: 2, CollectionType_En: "Without Collection", OrderStatus_En: "New", CityId: 1 }, "15202016");
    expect(p).toMatchObject({ found: true, externalId: "15202016", barcode: "15202016", invoice: "I-001", status: "New", recipientName: "test Recipient Name", recipientPhone: "96600000000", address: "test Recipient Address", city: "Riyadh", codAmount: 0, pieces: 2, notes: "Some Notes", lat: null });
    expect(p.extra).toMatchObject({ collectionType: "Without Collection", agentTotal: 100, isDelivered: false });
    // Any collection type other than the documented "1 = Without Collection" leaves COD for the business to confirm.
    expect(fizzpaPackage({ OrderId: 1, CollectionTypeId: 2, AgentTotal: 100 }, "1").codAmount).toBeNull();
  });
});

describe("LogesTech (documented webhook + PackageStatusResponse)", () => {
  it("reads the status webhook example", () => {
    const r = asResult(logestechs.parseWebhook!({ packageId: 123456, barcode: "PS000123456", invoiceNumber: "INV-000123", newStatus: "DELIVERED_TO_RECIPIENT", status: "DELIVERED_TO_RECIPIENT", cod: 45.5, paymentMethod: "CASH", time: "2026-08-23T10:15:00.000Z", driverName: "Ahmad", driverPhone: "+9665xxxxxxxx", pinCode: "1234", signatureUrl: "https://x/sig.png" }, ctx(), new Headers()));
    expect(r.events![0]).toMatchObject({ externalId: "123456", barcode: "PS000123456", invoice: "INV-000123", status: "DELIVERED_TO_RECIPIENT", kind: "delivered" });
    expect(r.orders![0]).toMatchObject({ externalId: "123456", externalRef: "PS000123456", codAmount: 45.5 });
    const stored = JSON.stringify(r.events![0].summary);
    expect(stored).not.toContain("1234"); expect(stored).not.toContain("+9665"); expect(stored).not.toContain("sig.png");
  });
  it("picks the newest history entry", () => {
    const ev = latestHistory([
      { packageId: 9, createdDate: "2026-01-01T10:00:00Z", statusKey: "PENDING_CUSTOMER_CARE_APPROVAL" },
      { packageId: 9, createdDate: "2026-01-02T10:00:00Z", statusKey: "CANCELLED", failedStatus: "customer request" },
      { packageId: 9, createdDate: "2026-01-01T12:00:00Z", packageTrackingStatus: "SCANNED" },
    ], "PS9")!;
    expect(ev).toMatchObject({ externalId: "9", barcode: "PS9", status: "CANCELLED", kind: "cancelled", note: "customer request" });
    expect(latestHistory([], "x")).toBeNull();
    expect(classifyStatus("RETURNED_TO_SENDER")).toBe("returned");
  });
});

describe("Fastcoo (samples from the Partner page)", () => {
  const order = { app_id: "f136xxxxxxxxxxxxxxxxxxxxxx", merchent_id: "5f8xxxxxxxxxxxx", reference_id: "78647xxxxxxxxxxx", BookingMode: "CC", codValue: 0, awb_no: "FSL25xxxxxxxxx", sender_city: "Riyadh", sender_name: "fastcooe", sender_address: "Riyadh old city ", sender_phone: "966xxxxxxxxxx", sender_email: "test@gmail.com", sender_zip: "54xxxxxx", receiver_city: "Riyadh", receiver_name: "xxxxxxxxx", receiver_address: "Address xxxxxxxxx", receiver_phone: "054xxxxxxxxxx", receiver_email: "test@gmail.com", country_dial_code: "+966", description: "test", pieces: "1", weight: "1", sku_details: "test", national_address_id: "FST5XXXXXXX", sender_national_id: "FST5XXXXXXX" };
  it("reads the Order Receive payload (BookingMode CC = prepaid, COD = cash collect)", () => {
    const o = fastcooOrder(order)!;
    expect(o).toMatchObject({ externalId: "FSL25xxxxxxxxx", externalRef: "FSL25xxxxxxxxx", invoice: "78647xxxxxxxxxxx", codAmount: 0, pieces: 1, weightKg: 1, contents: "test", currency: "SAR" });
    expect(o.recipient).toMatchObject({ name: "xxxxxxxxx", phone: "054xxxxxxxxxx", address: "Address xxxxxxxxx", city: "Riyadh", email: "test@gmail.com" });
    expect(o.pickup).toMatchObject({ name: "fastcooe", city: "Riyadh" });
    expect(o.extra).toMatchObject({ merchantId: "5f8xxxxxxxxxxxx", bookingMode: "CC", nationalAddressId: "FST5XXXXXXX" });
    expect(fastcooOrder({ ...order, BookingMode: "COD", codValue: "117.00" })!.codAmount).toBe(117);
    expect(fastcooOrder({ ...order, receiver_phone: "555123456" })!.recipient.phone).toBe("+966555123456");
  });
  it("accepts only orders for its own App ID, and reads a status payload", () => {
    const mine = asResult(fastcoo.parseWebhook!(order, ctx({ appId: "f136xxxxxxxxxxxxxxxxxxxxxx" }), new Headers()));
    expect(mine.orders).toHaveLength(1);
    expect(fastcoo.parseWebhook!(order, ctx({ appId: "someone-else" }), new Headers())).toBeNull();
    const st = asResult(fastcoo.parseWebhook!({ awb_no: "FSL541xxxxxx", reference_id: "21xxx", status: "Shelve", code: "SH", updated_date: "2021-11-16 11:34:21", comment: "test", delivery_attempts: "0" }, ctx({ appId: "a" }), new Headers()));
    expect(st.events![0]).toMatchObject({ barcode: "FSL541xxxxxx", status: "SH", kind: "status" });
    const cancel = asResult(fastcoo.parseWebhook!({ awb_no: "FSL1", code: "CCR", status: "Cancelled as per Client request" }, ctx({ appId: "a" }), new Headers()));
    expect(cancel.events![0].kind).toBe("cancelled");
  });
  it("formats UpdateDate as YYYY-MM-DD HH:MM:SS in the configured time zone", () => {
    expect(fastcooDate("2025-03-07T05:18:22.000Z", "Asia/Riyadh")).toBe("2025-03-07 08:18:22");
    expect(fastcooDate("2025-03-07T23:59:59.000Z", "UTC")).toBe("2025-03-07 23:59:59");
  });
});

describe("Custom system contract", () => {
  it("reads status changes, new orders and batches", () => {
    const one = generic.parseWebhook!({ reference: "ORD-1", status: "cancelled", note: "n", at: "2026-01-01T00:00:00Z" }, ctx(), new Headers()) as WebhookResult;
    expect(one.events![0]).toMatchObject({ barcode: "ORD-1", kind: "cancelled", note: "n" });
    const ord = generic.parseWebhook!({ type: "order", reference: "ORD-2", id: "x9", recipient: { name: "Ali", phone: "0555123456", address: "Olaya", city: "Riyadh" }, cod: 50, pieces: 2 }, ctx(), new Headers()) as WebhookResult;
    expect(ord.orders![0]).toMatchObject({ externalRef: "ORD-2", externalId: "x9", codAmount: 50, pieces: 2, recipient: { name: "Ali", city: "Riyadh" } });
    const batch = generic.parseWebhook!({ items: [{ reference: "A", status: "ready" }, { type: "order", reference: "B", recipient: {} }, { nope: 1 }] }, ctx(), new Headers()) as WebhookResult;
    expect(batch.events).toHaveLength(1); expect(batch.orders).toHaveLength(1);
    expect(generic.parseWebhook!({ hello: "world" }, ctx(), new Headers())).toBeNull();
  });
});
