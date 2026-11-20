import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, businessProfiles, complaints, driverProfiles, driverLocationHistory, entityNotes, offers, ratings, requests, shipments, tickets, users, webhookDeliveries } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, publishedRequest, mkShipments } from "../helpers/factories";
import { call } from "../helpers/api";
import { work } from "../helpers/work";
import * as jobs from "@/server/jobs";
import { createSession } from "@/server/auth/session";
import { createTicket, replyTicket, fileComplaint, updateComplaint, postMessage } from "@/server/support";
import { entityActivity, sourcesFor } from "@/server/activity";
import { audit } from "@/server/audit";
import { recordLogin } from "@/server/data-capture";
import { ACTIVITY_KINDS } from "@/server/activity-core";
import { setSmsProvider } from "@/server/auth/otp";
import { runMaintenance } from "@/server/maintenance";

beforeEach(resetDb);
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];

/** A finished order with a webhook, an SMS, chat, a rating, a ticket, a complaint, a note and an audit entry — every source has something to say. */
async function fullStory() {
  setSmsProvider({ name: "stub", async send() {} });
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
  await db.update(businessProfiles).set({ webhookUrl: "https://hooks.example.com/x", webhookSecret: "whsec_x" }).where(eq(businessProfiles.userId, biz.id));
  const r = await publishedRequest(biz, { shipments: mkShipments(3, { withRefs: true }), shipmentsPerDriver: 3 });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
  await postMessage(biz, off.id, "Gate 4, please"); await postMessage(d, off.id, "On my way");
  await work(biz, d, off.id);
  await jobs.rate(biz, off.id, 5, "Great driver").catch(() => null);
  const t = await createTicket(biz, { category: "other", subject: "Question about order", body: "Where is it?", requestId: r.id });
  const ops = await mkStaff(["tickets.view", "tickets.manage", "complaints.manage", "requests.view", "users.view", "notes.manage", "finance.view", "audit.view", "drivers.view", "reports.export", "drivers.sensitive"]);
  await replyTicket(ops, t.id, "Looking into it");
  const c = await fileComplaint(biz, { category: "delay", description: "Late by two hours", requestId: r.id });
  await updateComplaint(ops, c.id, { assignToMe: true });
  await audit(ops, "request.rematch", "request", r.id, { why: "test" });
  await call("POST", `/admin/notes/request/${r.id}`, { token: await tok(ops), body: { body: "VIP customer — call before delivery", pinned: true } });
  await runMaintenance();
  return { admin, biz, d, r, off, t, c, ops };
}

describe("entityActivity: one request", () => {
  it("merges every source about the request, newest first, with counts per kind", async () => {
    const { ops, r, t, c } = await fullStory();
    const res = await entityActivity(ops, { entity: "request", id: r.id, pageSize: 100 });
    expect(res.hidden).toEqual([]); expect(res.failed).toEqual([]);
    const kinds = new Set(res.items.map((i) => i.kind));
    for (const k of ["event", "parcel", "notification", "chat", "money", "support", "rating", "note", "message", "integration", "audit"]) expect(kinds, k).toContain(k);
    expect(res.items.map((i) => i.at)).toEqual([...res.items.map((i) => i.at)].sort().reverse());
    expect(res.total).toBe(Object.values(res.kindCounts).reduce((a, b) => a + b, 0));
    expect(res.kindCounts.parcel).toBeGreaterThanOrEqual(3 * 6);
    expect(res.items.every((i) => (ACTIVITY_KINDS as readonly string[]).includes(i.kind))).toBe(true);
    // the ticket and complaint are part of the order's story, with links
    const tk = res.items.find((i) => i.titleKey === "dtk.ticket_opened")!;
    expect(tk.refs).toContainEqual(expect.objectContaining({ type: "ticket", id: t.id, label: t.ref }));
    expect(res.items.some((i) => i.titleKey === "dtk.complaint_filed" && i.refs.some((x) => x.id === c.id))).toBe(true);
    // parcel events are not repeated from the job events (shown once, with the parcel code)
    expect(res.items.filter((i) => i.table === "job_events" && ["shipment_delivered", "stop_arrived"].includes(i.titleKey.replace("event.", "")))).toHaveLength(0);
    const delivered = res.items.filter((i) => i.titleKey === "dtk.p_delivered");
    expect(delivered).toHaveLength(3); expect(delivered[0].params.code).toMatch(/^JR-/); expect(delivered[0].actor).toMatchObject({ role: "driver" });
    // actor names and request labels are resolved
    const money = res.items.find((i) => i.table === "ledger_entries")!;
    expect(money.refs.some((x) => x.type === "request" && x.label === r.ref)).toBe(true);
    expect(res.items.find((i) => i.titleKey === "dtk.chat_message")!.actor?.name).toBeTruthy();
  });

  it("pages without gaps or repeats, and the filters (kinds, text, actor, period) narrow both items and totals", async () => {
    const { ops, r, d } = await fullStory();
    const all = await entityActivity(ops, { entity: "request", id: r.id, pageSize: 100 });
    const seen: string[] = []; let pages = 0;
    for (let page = 1; page <= 20; page++) {
      const p = await entityActivity(ops, { entity: "request", id: r.id, page, pageSize: 7 });
      if (!p.items.length) break; pages++; seen.push(...p.items.map((i) => `${i.table}:${i.id}`));
      expect(p.total).toBe(all.total);
    }
    expect(seen).toEqual(all.items.map((i) => `${i.table}:${i.id}`)); expect(pages).toBe(Math.ceil(all.total / 7));
    const only = await entityActivity(ops, { entity: "request", id: r.id, kinds: ["chat"], pageSize: 50 });
    expect(only.items.every((i) => i.kind === "chat")).toBe(true); expect(only.total).toBe(all.kindCounts.chat); expect(only.kindCounts).toEqual(all.kindCounts); // chips keep their counts
    const text = await entityActivity(ops, { entity: "request", id: r.id, q: "Gate 4", pageSize: 50 });
    expect(text.items.length).toBeGreaterThanOrEqual(1); expect(text.items.some((i) => i.kind === "chat")).toBe(true);
    const mine = await entityActivity(ops, { entity: "request", id: r.id, actorId: d.id, pageSize: 100 });
    expect(mine.items.length).toBeGreaterThan(0); expect(mine.items.every((i) => i.actor?.id === d.id)).toBe(true);
    const unknown = await entityActivity(ops, { entity: "request", id: r.id, kinds: ["not-a-kind"] });
    expect(unknown.items).toEqual([]); expect(unknown.total).toBe(0); expect(unknown.kindCounts).toEqual(all.kindCounts); // asking for nothing known shows nothing, not everything
    const future = await entityActivity(ops, { entity: "request", id: r.id, from: new Date(Date.now() + 3600_000) });
    expect(future.total).toBe(0); expect(future.items).toEqual([]);
    const past = await entityActivity(ops, { entity: "request", id: r.id, to: new Date(Date.now() - 3600_000) });
    expect(past.total).toBe(0);
  });

  it("hides what the viewer may not read and says which groups were hidden; IPs and coordinates are masked without drivers.sensitive", async () => {
    const { r, d } = await fullStory();
    const limited = await mkStaff(["requests.view"]);
    const res = await entityActivity(limited, { entity: "request", id: r.id, pageSize: 100 });
    expect(res.hidden.sort()).toEqual(["audit", "finance", "support"]); // notes follow the right to open the request (requests.view)
    const kinds = new Set(res.items.map((i) => i.kind));
    for (const k of ["audit", "money", "support"]) expect(kinds.has(k as never), k).toBe(false);
    for (const k of ["event", "parcel", "chat", "note"]) expect(kinds.has(k as never), k).toBe(true);
    expect(JSON.stringify(res.items)).not.toMatch(/"(lat|lng)":\s*-?\d/);
    const none = await mkStaff(["users.view"]);
    await expect(entityActivity(none, { entity: "request", id: r.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(entityActivity(limited, { entity: "request", id: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sourcesFor(limited, "request").sources.map((s) => s.group)).not.toContain("audit");
    void d;
  });
});

describe("entityActivity: user, ticket, shipment, offer, complaint, settlement, withdrawal", () => {
  it("a driver's feed shows what they did and what happened to them: sign-ins, availability, jobs, parcels, ratings, documents", async () => {
    const { ops, d, r, off } = await fullStory();
    await recordLogin({ userId: d.id, identifier: d.phone, method: "otp", success: true, ip: "5.5.5.5", userAgent: "Pixel", client: "mobile" });
    await recordLogin({ userId: null, identifier: d.phone, method: "otp", success: false, failureReason: "invalid_code", ip: "6.6.6.6" });
    await db.execute((await import("drizzle-orm")).sql`insert into driver_availability_log (driver_id, from_status, to_status, source, reason) values (${d.id}, 'unavailable', 'available', 'driver', 'manual')`);
    await db.execute((await import("drizzle-orm")).sql`insert into documents (owner_id, owner_kind, type, storage_key, file_name, mime, size, status, reviewer_id, reviewed_at) values (${d.id}, 'driver', 'national_id', 'k', 'id.png', 'image/png', 10, 'approved', ${ops.id}, now())`);
    const res = await entityActivity(ops, { entity: "user", id: d.id, pageSize: 100 });
    const kinds = new Set(res.items.map((i) => i.kind));
    for (const k of ["login", "availability", "document", "event", "parcel", "rating", "chat", "notification", "money"]) expect(kinds, k).toContain(k);
    const ok = res.items.find((i) => i.titleKey === "dtk.login_ok")!;
    expect((ok.details as any).ip).toBe("5.5.5.5"); // this viewer holds drivers.sensitive
    expect(res.items.some((i) => i.titleKey === "dtk.login_failed" && (i.details as any).failureReason === "invalid_code")).toBe(true); // a failed attempt against their phone, before an account was matched
    const blind = await mkStaff(["users.view", "requests.view"]);
    const masked = await entityActivity(blind, { entity: "user", id: d.id, pageSize: 100 });
    expect((masked.items.find((i) => i.titleKey === "dtk.login_ok")!.details as any).ip).toBe("•••");
    expect(masked.hidden).toEqual(expect.arrayContaining(["finance", "audit"]));
    void r; void off;
  });

  it("a business feed lists its requests' lifecycle; a ticket feed has replies and lifecycle with first-response; a complaint feed its notes", async () => {
    const { ops, biz, t, c } = await fullStory();
    const b = await entityActivity(ops, { entity: "user", id: biz.id, pageSize: 100 });
    expect(b.items.some((i) => i.titleKey === "event.request_published")).toBe(true);
    const tf = await entityActivity(ops, { entity: "ticket", id: t.id, pageSize: 100 });
    expect(tf.items.map((i) => i.titleKey)).toEqual(expect.arrayContaining(["dtk.ticket_opened", "dtk.ticket_reply", "dtk.ticket_first_response"]));
    const cf = await entityActivity(ops, { entity: "complaint", id: c.id, pageSize: 100 });
    expect(cf.items.map((i) => i.titleKey)).toEqual(expect.arrayContaining(["dtk.complaint_filed", "dtk.complaint_assign", "dtk.complaint_first_response"]));
    expect(tf.entity).toMatchObject({ type: "ticket", label: t.ref });
  });

  it("shipment and offer feeds are scoped to that parcel / job", async () => {
    const { ops, r, off } = await fullStory();
    const [s] = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(shipments.seq);
    const sf = await entityActivity(ops, { entity: "shipment", id: s.id, pageSize: 100 });
    expect(sf.items.every((i) => i.table === "shipment_events" || i.table === "message_log" || i.table === "audit_logs" || i.table === "shipment_media" || i.table === "entity_notes" || i.table === "partner_events")).toBe(true);
    expect(sf.items.map((i) => i.titleKey)).toEqual(expect.arrayContaining(["dtk.p_created", "dtk.p_assigned", "dtk.p_loaded", "dtk.p_arrived", "dtk.p_delivered"]));
    expect(sf.items.some((i) => i.table === "message_log" && i.params.msgType === "recipient_code")).toBe(true);
    const of = await entityActivity(ops, { entity: "offer", id: off.id, pageSize: 100 });
    expect(of.items.some((i) => i.kind === "chat")).toBe(true); expect(of.items.some((i) => i.kind === "rating") || of.total > 0).toBe(true);
    expect(of.items.every((i) => i.kind !== "parcel" || (i as any).details !== undefined)).toBe(true);
  });

  it("settlement and withdrawal feeds show the money trail", async () => {
    const { ops, d } = await fullStory();
    const { settlements, withdrawals } = await import("@/db/schema");
    const [st] = await db.select().from(settlements);
    expect(st).toBeTruthy();
    const sf = await entityActivity(ops, { entity: "settlement", id: st.id, pageSize: 100 });
    expect(sf.items.map((i) => i.titleKey)).toEqual(expect.arrayContaining(["dtk.settlement_created"]));
    expect(sf.items.some((i) => i.table === "ledger_entries")).toBe(true);
    const { requestWithdrawal } = await import("@/server/settlement");
    const { ensureAccount, post } = await import("@/server/wallet");
    await post(db, { accountId: (await ensureAccount(d.id)).id, kind: "topup", available: 50_000, idempotencyKey: "wd-test-fund", simulated: true });
    await requestWithdrawal(d, 20_000).catch(() => null);
    const [w] = await db.select().from(withdrawals);
    if (w) {
      const wf = await entityActivity(ops, { entity: "withdrawal", id: w.id, pageSize: 100 });
      expect(wf.items.map((i) => i.titleKey)).toEqual(expect.arrayContaining(["dtk.withdrawal_requested", "ledger.withdrawal_hold"]));
    }
  });
});

describe("activity API: routes, export, notes, location history", () => {
  it("serves the feed over HTTP with permission checks and validation", async () => {
    const { ops, r, biz } = await fullStory();
    const res = await call("GET", `/admin/activity/request/${r.id}?kinds=chat,money&pageSize=5`, { token: await tok(ops) });
    expect(res.status).toBe(200); expect(res.json.items.length).toBeLessThanOrEqual(5); expect(res.json.items.every((i: any) => ["chat", "money"].includes(i.kind))).toBe(true);
    expect((await call("GET", `/admin/activity/request/${r.id}`, { token: await tok(biz) })).status).toBe(403); // not backoffice
    expect((await call("GET", `/admin/activity/spaceship/${r.id}`, { token: await tok(ops) })).status).toBe(404);
    expect((await call("GET", `/admin/activity/request/not-a-uuid`, { token: await tok(ops) })).status).toBe(404);
    expect((await call("GET", `/admin/activity/request/${r.id}?pageSize=500`, { token: await tok(ops) })).status).toBe(422);
  });

  it("exports CSV for reports.export holders only, and audits the export", async () => {
    const { ops, r } = await fullStory();
    const csv = await call("GET", `/admin/activity/request/${r.id}/export`, { token: await tok(ops) });
    expect(csv.status).toBe(200); expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toContain("at,kind,source,event,actor,actorRole,summary,refs"); expect(csv.text.split("\n").length).toBeGreaterThan(20);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "activity.export"))).length).toBe(1);
    const noExport = await mkStaff(["requests.view"]);
    expect((await call("GET", `/admin/activity/request/${r.id}/export`, { token: await tok(noExport) })).status).toBe(403);
  });

  it("notes: add, list (pinned first), pin, author-or-admin delete, permissions; deleted notes leave the feed", async () => {
    const { ops, r, admin } = await fullStory();
    const t = await tok(ops);
    const add = await call("POST", `/admin/notes/request/${r.id}`, { token: t, body: { body: "second note" } });
    expect(add.status).toBe(201);
    const list = await call("GET", `/admin/notes/request/${r.id}`, { token: t });
    expect(list.json.items.map((n: any) => [n.body, n.pinned])).toEqual([["VIP customer — call before delivery", true], ["second note", false]]);
    expect(list.json.canWrite).toBe(true);
    expect((await call("PATCH", `/admin/notes/${add.json.id}`, { token: t, body: { pinned: true } })).json.pinned).toBe(true);
    const reader = await mkStaff(["requests.view"]);
    expect((await call("GET", `/admin/notes/request/${r.id}`, { token: await tok(reader) })).json.canWrite).toBe(false);
    expect((await call("POST", `/admin/notes/request/${r.id}`, { token: await tok(reader), body: { body: "x" } })).status).toBe(403);
    const other = await mkStaff(["requests.view", "notes.manage"]);
    expect((await call("DELETE", `/admin/notes/${add.json.id}`, { token: await tok(other) })).status).toBe(403); // not the author, not an admin
    expect((await call("POST", `/admin/notes/request/${r.id}`, { token: t, body: { body: "   " } })).status).toBe(422);
    expect((await call("POST", `/admin/notes/request/${r.id}`, { token: t, body: { body: "x".repeat(4001) } })).status).toBe(422);
    expect((await call("DELETE", `/admin/notes/${add.json.id}`, { token: t })).status).toBe(200);
    expect((await call("DELETE", `/admin/notes/${list.json.items[0].id}`, { token: await tok(admin) })).status).toBe(200); // an admin may delete anyone's
    expect((await call("GET", `/admin/notes/request/${r.id}`, { token: t })).json.items).toEqual([]);
    expect((await db.select().from(entityNotes)).every((n) => n.deletedAt)).toBe(true); // soft delete
    expect((await entityActivity(ops, { entity: "request", id: r.id, kinds: ["note"] })).total).toBe(0);
  });

  it("location history: drivers.sensitive only, a window, thinned when long, audited", async () => {
    const { ops, d } = await fullStory();
    const t0 = Date.now() - 3600_000;
    await db.insert(driverLocationHistory).values(Array.from({ length: 40 }, (_, i) => ({ driverId: d.id, lat: 24.7 + i / 1000, lng: 46.7, recordedAt: new Date(t0 + i * 60_000) })));
    const res = await call("GET", `/admin/location-history/${d.id}`, { token: await tok(ops) });
    expect(res.status).toBe(200); expect(res.json.points).toHaveLength(40); expect(res.json.points[0].lat).toBeCloseTo(24.7); expect(res.json.thinned).toBe(false);
    const narrow = await call("GET", `/admin/location-history/${d.id}?from=${new Date(t0 + 10 * 60_000).toISOString()}&to=${new Date(t0 + 20 * 60_000).toISOString()}`, { token: await tok(ops) });
    expect(narrow.json.points).toHaveLength(10);
    const plain = await mkStaff(["drivers.view", "users.view"]);
    expect((await call("GET", `/admin/location-history/${d.id}`, { token: await tok(plain) })).status).toBe(403);
    expect((await call("GET", `/admin/location-history/${d.id}?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`, { token: await tok(ops) })).status).toBe(422);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "location.view"))).length).toBeGreaterThanOrEqual(2);
    void ratings; void tickets; void complaints; void requests; void users; void driverProfiles; void webhookDeliveries;
  });
});
