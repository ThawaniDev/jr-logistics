/**
 * Field-operations overhaul — cash on delivery (E17), the removed finance steps (E18) and support tickets for everyone (E15).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, jobEvents, notifications, offers, shipments, ticketAttachments, tickets } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest, mkShipments, reqInput, WAREHOUSE } from "../helpers/factories";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createSession } from "@/server/auth/session";
import { createDraft } from "@/server/requests";
import { currentStopOf, otpFor } from "@/server/shipments";
import { driverJobView } from "@/server/views";
import { finishLoading, scanLoad } from "@/server/loading";
import { adminCod, businessCod, driverCash, listRemittances, receiveCash } from "@/server/cod";
import { setSmsProvider } from "@/server/auth/otp";
import { demoShipments } from "@/server/demo-shipments";
import { createTicket, getTicket, readTicketAttachment, reopenTicket, replyTicket, resolveTicket, staffUpdateTicket, ticketAssignees, uploadTicketAttachment } from "@/server/support";
import { requests } from "@/db/schema";

beforeEach(resetDb);
afterAll(shutdown);
afterEach(() => setSmsProvider(null));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const parcels = (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.seq));
async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00 }); return { admin, biz }; }

/** A job whose parcels carry the given COD amounts (halalas), driver at the first stop, route approved. */
async function codJob(cod: number[], extra: { biz?: Awaited<ReturnType<typeof mkBusiness>>; driver?: Awaited<ReturnType<typeof mkDriver>> } = {}) {
  const base = extra.biz ? { admin: await mkAdmin().catch(() => null as never), biz: extra.biz } : await setup();
  const biz = base.biz; const d = extra.driver ?? await mkDriver();
  const rows = mkShipments(cod.length, { withRefs: true }).map((s, i) => ({ ...s, codCents: cod[i] }));
  const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: cod.length });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true);
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
  await jobs.checkIn(d, off.id, WAREHOUSE); await jobs.confirmAttendance(biz, off.id, true);
  for (const p of await parcels(off.id)) await scanLoad(d, off.id, p.code);
  await finishLoading(d, off.id); await stops.approveRoute(d, off.id);
  return { ...base, d, r, off, ps: (await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!) };
}
async function deliverNext(d: any, off: { id: string }) {
  const s = (await currentStopOf(db, off.id))!;
  await stops.arriveAtStop(d, off.id, s.id);
  return stops.deliverStop(d, off.id, s.id, { code: s.code, otp: otpFor(s), cashCollectedCents: s.codCents > 0 ? s.codCents : undefined });
}

describe("E17 cash on delivery", () => {
  it("a parcel carries its COD amount (validated), the driver sees what to collect, SMS tells the recipient the amount", async () => {
    const sent: string[] = []; setSmsProvider({ name: "t", async send(_to: string, text: string) { sent.push(text); } } as never);
    const { biz } = await setup();
    const rows = mkShipments(2);
    for (const bad of [-1, 1.5, 10_000_001]) await expect(createDraft(biz, reqInput({ shipments: [{ ...rows[0], codCents: bad }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 1, field: "shipments.0.codCents" } });
    const { d, off, ps } = await codJob([12_050, 0]);
    expect(ps.map((p) => p.codCents)).toEqual([12_050, 0]);
    const o = (await db.select().from(offers).where(eq(offers.id, off.id)))[0];
    const view = await driverJobView(o, (await db.select().from(requests).where(eq(requests.id, o.requestId)))[0]);
    expect(view.cod).toEqual({ toCollectCents: 12_050, collectedCents: 0, parcels: 1 });
    expect(view.stops![0]).toMatchObject({ codCents: 12_050, codCollectedCents: null }); expect(view.stops![1]).toMatchObject({ codCents: 0 });
    expect(sent.some((m) => m.includes("120.50"))).toBe(true);
    // editable by the warehouse while the parcel is still at the warehouse; a driver-held parcel is locked
    void d;
  });

  it("delivery needs the exact cash confirmation; the collected amount is recorded; failed parcels hold no cash", async () => {
    const { d, off, ps } = await codJob([5_000, 7_500, 3_000]);
    const [s1, s2, s3] = ps;
    await stops.arriveAtStop(d, off.id, s1.id);
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "CASH_MISMATCH", status: 422, details: { expectedCents: 5_000 } });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1), cashCollectedCents: 4_999 })).rejects.toMatchObject({ code: "CASH_MISMATCH" });
    expect((await db.select().from(shipments).where(eq(shipments.id, s1.id)))[0].otpAttempts).toBe(0); // a cash slip never burns the recipient's OTP attempt
    const done = await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1), cashCollectedCents: 5_000 });
    expect(done).toMatchObject({ status: "delivered", codCollectedCents: 5_000 }); expect(done.codCollectedAt).toBeTruthy();
    await deliverNext(d, off); // s2 7 500
    await stops.arriveAtStop(d, off.id, s3.id); await stops.failStop(d, off.id, s3.id, { reason: "refused" }); // s3: refused → no cash
    expect((await db.select().from(shipments).where(eq(shipments.id, s3.id)))[0].codCollectedCents).toBeNull();
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).filter((e) => e.type === "shipment_delivered");
    expect(ev[0].payload).toMatchObject({ codCents: 5_000 });
    const c = await driverCash(d);
    expect(c).toMatchObject({ collectedCents: 12_500, receivedCents: 0, outstandingCents: 12_500 });
    expect(c.orders).toEqual([expect.objectContaining({ offerId: off.id, parcels: 2, collectedCents: 12_500, outstandingCents: 12_500 })]);
    void s2;
  });

  it("the driver's cash: home figure, per-order list, shrinks as the warehouse records receipts; the warehouse's per-driver view matches", async () => {
    const { biz, d, off } = await codJob([10_000, 20_000]);
    await deliverNext(d, off); await deliverNext(d, off);
    await jobs.reportDelivered(d, off.id);
    const t = await tok(d);
    expect((await call("GET", "/driver/overview", { token: t })).json.cash).toEqual({ outstandingCents: 30_000, orders: 1 });
    const bc = await businessCod(biz);
    expect(bc.totals).toEqual({ collectedCents: 30_000, receivedCents: 0, outstandingCents: 30_000 });
    expect(bc.drivers).toEqual([expect.objectContaining({ driverId: d.id, driverName: d.name, outstandingCents: 30_000, orders: [expect.objectContaining({ offerId: off.id, outstandingCents: 30_000 })] })]);
    expect(JSON.stringify(bc)).not.toContain(d.phone); // phones are masked
    const bt = await tok(biz);
    const r1 = await call("POST", "/business/cod/receive", { token: bt, body: { offerId: off.id, amountCents: 12_000, note: "first handover" } });
    expect(r1.status).toBe(201); expect(r1.json).toMatchObject({ amountCents: 12_000, driverId: d.id, receivedByRole: "business", ref: expect.stringMatching(/^COD-/) });
    expect((await driverCash(d))).toMatchObject({ collectedCents: 30_000, receivedCents: 12_000, outstandingCents: 18_000, recent: [expect.objectContaining({ amountCents: 12_000, note: "first handover", receivedByRole: "business" })] });
    expect((await call("GET", "/business/cod", { token: bt })).json.totals.outstandingCents).toBe(18_000);
    // never more than outstanding; never zero; unknown offers refused
    const over = await call("POST", "/business/cod/receive", { token: bt, body: { offerId: off.id, amountCents: 18_001 } });
    expect(over.status).toBe(422); expect(over.json.error.details).toMatchObject({ field: "amountCents", max: 18_000 });
    expect((await call("POST", "/business/cod/receive", { token: bt, body: { offerId: off.id, amountCents: 0 } })).status).toBe(422);
    await receiveCash(biz, off.id, 18_000);
    expect((await driverCash(d)).outstandingCents).toBe(0);
    await expect(receiveCash(biz, off.id, 1)).rejects.toMatchObject({ code: "VALIDATION", details: { max: 0 } });
    // history + notification + timeline
    const hist = await call("GET", "/business/cod/remittances", { token: bt });
    expect(hist.json.total).toBe(2); expect(hist.json.items[0]).toMatchObject({ driverName: d.name, receivedByRole: "business" });
    expect((await db.select().from(notifications).where(and(eq(notifications.userId, d.id), eq(notifications.type, "cod_received")))).map((n) => (n.data as any).amount)).toEqual(expect.arrayContaining(["120.00", "180.00"]));
    expect((await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).filter((e) => e.type === "cod_received")).toHaveLength(2);
    expect((await call("GET", "/driver/cash", { token: t })).json.outstandingCents).toBe(0);
  });

  it("only the owning warehouse or ops with cod.manage can receive cash; ops are audited; two simultaneous receipts cannot exceed what is held", async () => {
    const { biz, d, off } = await codJob([10_000]);
    await deliverNext(d, off); await jobs.reportDelivered(d, off.id);
    const other = await mkBusiness();
    await expect(receiveCash(other, off.id, 100)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receiveCash(d, off.id, 100)).rejects.toMatchObject({ code: "FORBIDDEN" }); // the driver cannot mark his own cash as handed over
    const viewer = await mkStaff(["finance.view"]); const ops = await mkStaff(["cod.manage"]);
    await expect(receiveCash(viewer, off.id, 100)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await Promise.allSettled([receiveCash(biz, off.id, 6_000), receiveCash(ops, off.id, 6_000)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1); // 6 000 + 6 000 > 10 000: exactly one wins
    expect((await driverCash(d)).outstandingCents).toBe(4_000);
    const t = await tok(ops);
    const rec = await call("POST", "/admin/cod/receive", { token: t, body: { offerId: off.id, amountCents: 4_000, note: "collected at the depot" } });
    expect(rec.status).toBe(201);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "cod.receive"))).length).toBeGreaterThanOrEqual(1);
    expect((await call("POST", "/admin/cod/receive", { token: await tok(biz), body: { offerId: off.id, amountCents: 1 } })).status).toBe(403);
    // nothing collected → nothing to receive
    const empty = await codJob([0]);
    await deliverNext(empty.d, empty.off);
    await expect(receiveCash(empty.biz, empty.off.id, 100)).rejects.toMatchObject({ code: "NOTHING_TO_DO" });
  });

  it("ops overview: filters by warehouse / driver / outstanding / offer, totals, and the remittance list", async () => {
    const a = await codJob([10_000, 5_000]); const b = await codJob([8_000]);
    await deliverNext(a.d, a.off); await deliverNext(a.d, a.off); await jobs.reportDelivered(a.d, a.off.id);
    await deliverNext(b.d, b.off); await jobs.reportDelivered(b.d, b.off.id);
    await receiveCash(a.biz, a.off.id, 15_000);
    const ops = await mkStaff(["cod.manage"]); const t = await tok(ops);
    const all = await adminCod(ops, {});
    expect(all.totals).toEqual({ collectedCents: 23_000, receivedCents: 15_000, outstandingCents: 8_000 }); expect(all.total).toBe(2);
    expect((await adminCod(ops, { onlyOutstanding: true })).items).toEqual([expect.objectContaining({ offerId: b.off.id, outstandingCents: 8_000, driverName: b.d.name })]);
    expect((await adminCod(ops, { businessId: a.biz.id })).total).toBe(1);
    expect((await adminCod(ops, { driverId: b.d.id })).items[0].offerId).toBe(b.off.id);
    expect((await adminCod(ops, { offerId: a.off.id })).items).toHaveLength(1);
    expect((await adminCod(ops, { q: a.r.ref })).items[0].offerId).toBe(a.off.id);
    expect((await call("GET", "/admin/cod?onlyOutstanding=1", { token: t })).json.items).toHaveLength(1);
    expect((await listRemittances({ businessId: a.biz.id })).total).toBe(1);
    expect((await call("GET", "/admin/cod/remittances", { token: t })).json.total).toBe(1);
    await expect(adminCod(await mkStaff(["tickets.view"]), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await adminCod(await mkStaff(["finance.view"]), {})).total).toBe(2); // finance may look
    expect((await call("GET", "/admin/cod", { token: await tok(a.biz) })).status).toBe(403);
  });

  it("demo parcels: every third parcel is cash on delivery and the whole set is valid for a manifest", () => {
    const items = demoShipments("riyadh")!;
    expect(items.filter((i) => i.codCents > 0)).toHaveLength(27);
    expect(items.every((i) => Number.isInteger(i.codCents) && i.codCents >= 0 && i.codCents <= 10_000_000)).toBe(true);
  });
});

describe("E18 finance: nothing to approve", () => {
  it("the review / approve / reject / pay / retry / correct / batch routes are gone; the history list stays and searches by order, driver and parcel code", async () => {
    const { biz, d, off, r } = await codJob([0, 0]);
    await deliverNext(d, off); await deliverNext(d, off); await jobs.reportDelivered(d, off.id);
    const fin = await mkStaff(["finance.view", "settlements.review", "settlements.approve", "payouts.execute"]); const t = await tok(fin);
    const sid = (await call("GET", "/admin/finance/settlements", { token: t })).json.items[0].id;
    for (const [m, p] of [["POST", `/admin/finance/settlements/${sid}/review`], ["POST", `/admin/finance/settlements/${sid}/approve`], ["POST", `/admin/finance/settlements/${sid}/reject`], ["POST", `/admin/finance/settlements/${sid}/pay`], ["POST", `/admin/finance/settlements/${sid}/retry`], ["POST", `/admin/finance/settlements/${sid}/correct`], ["POST", "/admin/finance/payout-batches"], ["GET", "/admin/finance/payout-batches"], ["POST", `/offers/${off.id}/delivery-decision`]] as const)
      expect((await call(m, p, { token: m === "POST" && p.includes("delivery") ? await tok(biz) : t, ...(m === "POST" ? { body: {} } : {}) })).status, `${m} ${p}`).toBe(404);
    const l = await call("GET", "/admin/finance/settlements", { token: t });
    expect(l.json.items[0]).toMatchObject({ status: "paid", ref: r.ref, driverName: d.name });
    const [p1] = await parcels(off.id);
    for (const q of [r.ref, d.name.slice(0, 5), p1.code, p1.externalRef!]) { const x = await call("GET", `/admin/finance/settlements?q=${encodeURIComponent(q)}`, { token: t }); expect(x.json.total, `${q} → ${x.text.slice(0, 200)}`).toBe(1); }
    expect((await call("GET", "/admin/finance/settlements?q=nothing-like-this", { token: t })).json.total).toBe(0);
    expect((await call("GET", "/admin/finance/summary", { token: t })).json.pendingSettlements).toBe(0);
  });
});

describe("E15 support tickets for warehouses, drivers and delivery offices", () => {
  it("each role has its categories (incl. cod_issue / app_problem) and a wrong one is refused", async () => {
    const biz = await mkBusiness(); const d = await mkDriver(); const office = await mkOffice();
    expect((await createTicket(biz, { category: "cod_issue", subject: "Cash not received" })).category).toBe("cod_issue");
    expect((await createTicket(d, { category: "cod_issue", subject: "Cash mismatch at the door" })).category).toBe("cod_issue");
    expect((await createTicket(d, { category: "app_problem", subject: "Scanner will not open" })).category).toBe("app_problem");
    expect((await createTicket(office, { category: "app_problem", subject: "Cannot see my drivers" })).category).toBe("app_problem");
    await expect(createTicket(office, { category: "cod_issue", subject: "Not an office category" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "category" } });
    const cat = (await call("GET", "/catalog")).json.ticketCategories;
    expect(cat.driver).toEqual(expect.arrayContaining(["cod_issue", "app_problem"])); expect(cat.business).toContain("cod_issue"); expect(cat.office).toContain("app_problem");
  });

  it("photo / PDF attachments: validated, single-use, only the owner or staff can open them, shown on the message", async () => {
    const d = await mkDriver(); const other = await mkDriver(); const staff = await mkStaff(["tickets.view", "tickets.manage"]);
    await expect(uploadTicketAttachment(d, { name: "a.txt", mime: "text/plain", data: Buffer.from("hello world") })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "file" } });
    await expect(uploadTicketAttachment(d, { name: "a.png", mime: "image/png", data: Buffer.from("this is not a png") })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadTicketAttachment(d, { name: "big.png", mime: "image/png", data: Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]) })).rejects.toMatchObject({ code: "VALIDATION" });
    const a1 = await uploadTicketAttachment(d, { name: "damaged box.png", mime: "image/png", data: PNG });
    const a2 = await uploadTicketAttachment(d, { name: "receipt.pdf", mime: "application/pdf", data: PDF });
    expect(a1).toMatchObject({ name: "damaged box.png", mime: "image/png", size: PNG.length });
    const t = await createTicket(d, { category: "cod_issue", subject: "Customer paid less", body: "see the photo", attachmentIds: [a1.id, a2.id] });
    const det = await getTicket(d, t.id);
    expect(det.replies).toHaveLength(1); expect(det.replies[0].attachments.map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(det.replies[0].attachments.find((a) => a.id === a2.id)).toMatchObject({ mime: "application/pdf" });
    // used ones cannot be sent again; other people's cannot be used; at most 3 per message
    await expect(replyTicket(d, t.id, "again", false, [a1.id])).rejects.toMatchObject({ code: "VALIDATION", details: { field: "attachmentIds" } });
    const foreign = await uploadTicketAttachment(other, { name: "x.png", mime: "image/png", data: PNG });
    await expect(replyTicket(d, t.id, "stolen", false, [foreign.id])).rejects.toMatchObject({ code: "VALIDATION" });
    const four = await Promise.all([1, 2, 3, 4].map((i) => uploadTicketAttachment(d, { name: `f${i}.png`, mime: "image/png", data: PNG })));
    await expect(replyTicket(d, t.id, "four", false, four.map((x) => x.id))).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await replyTicket(d, t.id, "", false, four.slice(0, 1).map((x) => x.id))).body).toBe(""); // an attachment alone is a message
    // access
    expect((await readTicketAttachment(d, a1.id)).mime).toBe("image/png");
    expect((await readTicketAttachment(staff, a2.id)).name).toBe("receipt.pdf");
    await expect(readTicketAttachment(other, a1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readTicketAttachment(await mkStaff(["users.view"]), a1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const dt = await tok(d);
    const raw = await call("GET", `/tickets/attachments/${a1.id}`, { token: dt });
    expect(raw.status).toBe(200); expect(raw.headers.get("content-type")).toBe("image/png"); expect(raw.headers.get("content-disposition")).toContain("damaged box.png");
    expect((await call("GET", `/tickets/attachments/${a1.id}`, { token: await tok(other) })).status).toBe(404);
    // through the API: upload (multipart) → create with ids
    const fd = new FormData(); fd.set("file", new File([PNG], "shot.png", { type: "image/png" }));
    const up = await call("POST", "/uploads/ticket", { token: dt, form: fd });
    expect(up.status).toBe(201);
    const made = await call("POST", "/tickets", { token: dt, body: { category: "app_problem", subject: "Camera is black", attachmentIds: [up.json.id] } });
    expect(made.status).toBe(201);
    expect((await call("GET", `/tickets/${made.json.id}`, { token: dt })).json.replies[0].attachments).toHaveLength(1);
    expect((await call("POST", "/tickets", { token: dt, body: { category: "app_problem", subject: "Too many files", attachmentIds: four.slice(0, 2).map((x) => x.id).concat([up.json.id, a1.id]) } })).status).toBe(422);
    expect((await db.select().from(ticketAttachments).where(eq(ticketAttachments.uploadedBy, d.id))).every((a) => a.storageKey.startsWith("tickets/"))).toBe(true);
  });

  it("status, priority and assignment are the staff's; reopening is the customer's within 14 days; everyone is told", async () => {
    const biz = await mkBusiness(); const ops = await mkStaff(["tickets.view", "tickets.manage"]); const ops2 = await mkStaff(["tickets.view", "tickets.manage"]); const readOnly = await mkStaff(["tickets.view"]);
    const note = async (uid: string, type: string) => (await db.select().from(notifications).where(and(eq(notifications.userId, uid), eq(notifications.type, type)))).length;
    const t = await createTicket(biz, { category: "payment_issue", subject: "Wrong amount charged", body: "please check" });
    expect(await note(ops.id, "ticket_new")).toBe(1); expect(await note(ops2.id, "ticket_new")).toBe(1); expect(await note(readOnly.id, "ticket_new")).toBe(0);
    await replyTicket(biz, t.id, "any news?");
    expect(await note(ops.id, "ticket_reply_user")).toBe(1); // unassigned → the people who can handle tickets
    await expect(staffUpdateTicket(readOnly, t.id, { status: "in_review" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(staffUpdateTicket(ops, t.id, { assignTo: biz.id })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "assignTo" } }); // a customer cannot take tickets
    const u = await staffUpdateTicket(ops, t.id, { assignTo: ops2.id, priority: "urgent", status: "in_review" });
    expect(u).toMatchObject({ assignedTo: ops2.id, priority: "urgent", status: "in_review" });
    const ops2Before = await note(ops2.id, "ticket_reply_user"), ops1Before = await note(ops.id, "ticket_reply_user");
    await replyTicket(biz, t.id, "thanks");
    expect(await note(ops2.id, "ticket_reply_user")).toBe(ops2Before + 1); expect(await note(ops.id, "ticket_reply_user")).toBe(ops1Before); // now only the assignee, not everyone
    expect((await staffUpdateTicket(ops2, t.id, { assignToMe: true })).assignedTo).toBe(ops2.id);
    expect((await staffUpdateTicket(ops2, t.id, { assignTo: null })).assignedTo).toBeNull();
    // resolve (by staff) → the customer is told; the customer cannot just keep writing
    await staffUpdateTicket(ops, t.id, { status: "resolved" });
    expect(await note(biz.id, "ticket_resolved")).toBe(1);
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0].resolvedAt).toBeTruthy();
    await expect(replyTicket(biz, t.id, "one more thing")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const re = await reopenTicket(biz, t.id, "It is still wrong");
    expect(re).toMatchObject({ status: "open", resolvedAt: null });
    expect(await note(ops.id, "ticket_reopened")).toBe(1);
    await expect(reopenTicket(biz, t.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // not resolved any more
    expect((await getTicket(biz, t.id)).replies.at(-1)!.body).toBe("It is still wrong");
    // the 14-day window
    await resolveTicket(biz, t.id);
    await db.update(tickets).set({ resolvedAt: new Date(Date.now() - 15 * 864e5) }).where(eq(tickets.id, t.id));
    await expect(reopenTicket(biz, t.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION", message: expect.stringContaining("14 days") });
    expect((await reopenTicket(ops, t.id)).status).toBe("open"); // staff may reopen anytime
    // someone else's ticket
    await expect(reopenTicket(await mkBusiness(), t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("staff API: detail with names, assignees list, role filter; customers cannot use the staff routes", async () => {
    const biz = await mkBusiness({ name: "Sara Warehouse" }); const d = await mkDriver({ name: "Omar Driver" }); const ops = await mkStaff(["tickets.view", "tickets.manage"]);
    const t1 = await createTicket(biz, { category: "other", subject: "Question about invoices", body: "hello" });
    await createTicket(d, { category: "attendance_issue", subject: "Warehouse was closed", body: "hello" });
    const st = await tok(ops);
    const detail = await call("GET", `/admin/tickets/${t1.id}`, { token: st });
    expect(detail.status).toBe(200); expect(detail.json.ticket).toMatchObject({ openedByName: "Sara Warehouse", openedByRole: "business", assigneeName: null });
    expect(detail.json.replies[0]).toMatchObject({ authorName: "Sara Warehouse", authorRole: "business" });
    const patched = await call("PATCH", `/admin/tickets/${t1.id}`, { token: st, body: { assignToMe: true, status: "in_review" } });
    expect(patched.status).toBe(200); expect(patched.json).toMatchObject({ assignedTo: ops.id, status: "in_review" });
    expect((await call("GET", `/admin/tickets/${t1.id}`, { token: st })).json.ticket.assigneeName).toBe(ops.name);
    expect((await call("GET", "/admin/tickets/assignees", { token: st })).json.items).toEqual(expect.arrayContaining([{ id: ops.id, name: ops.name }]));
    expect((await ticketAssignees(ops)).items.some((x) => x.id === biz.id)).toBe(false);
    expect((await call("GET", "/admin/tickets?role=driver", { token: st })).json.items.map((i: any) => i.openedByRole)).toEqual(["driver"]);
    expect((await call("GET", "/admin/tickets?role=business", { token: st })).json.total).toBe(1);
    expect((await call("GET", "/admin/tickets", { token: st })).json.total).toBe(2);
    for (const [m, p] of [["GET", `/admin/tickets/${t1.id}`], ["PATCH", `/admin/tickets/${t1.id}`], ["GET", "/admin/tickets/assignees"]] as const) expect((await call(m, p, { token: await tok(biz), ...(m === "PATCH" ? { body: {} } : {}) })).status).toBe(403);
    // the customer's own view hides staff-only names and internal notes
    const mine = await call("GET", `/tickets/${t1.id}`, { token: await tok(biz) });
    expect(mine.json.ticket.assigneeName).toBeNull(); expect(mine.json.ticket.openedByName).toBeUndefined();
  });
});
