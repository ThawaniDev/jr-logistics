import { and, desc, eq, inArray, or, sql, count } from "drizzle-orm";
import { db } from "@/db";
import {
  tickets, ticketReplies, complaints, complaintNotes, custodyItems, messages, notifications, users, offers, requests, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES, TICKET_CATEGORIES } from "./catalog";
import { can, requirePerm } from "./auth/permissions";
import { jobAccess } from "./access";
import { openTicket, openComplaint } from "./jobs";
import { notify, notifyMany } from "./notify";
import { audit } from "./audit";
import { logEvent } from "./events";

// ───────── Tickets ─────────
export async function createTicket(user: User, i: { category: string; subject: string; body?: string; requestId?: string; offerId?: string }) {
  const allowed = (TICKET_CATEGORIES as Record<string, readonly string[]>)[user.role] ?? [];
  if (!allowed.includes(i.category)) throw err("VALIDATION", "Invalid category for your role", { field: "category" });
  if (!i.subject?.trim()) throw err("VALIDATION", "Subject required", { field: "subject" });
  if (i.offerId) await jobAccess(user, i.offerId);
  return db.transaction((tx) => openTicket(tx, user, i));
}

export async function listTickets(user: User, f: { status?: string; page?: number } = {}) {
  const staff = can(user, "tickets.view");
  const page = Math.max(f.page ?? 1, 1);
  const where = and(staff ? undefined : eq(tickets.openedBy, user.id), f.status ? eq(tickets.status, f.status) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select().from(tickets).where(where).orderBy(sql`(${tickets.priority} = 'urgent') desc`, desc(tickets.updatedAt)).limit(30).offset((page - 1) * 30),
    db.select({ total: count() }).from(tickets).where(where),
  ]);
  return { items, page, total: Number(total) };
}

export async function getTicket(user: User, id: string) {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  const staff = can(user, "tickets.view");
  if (!t || (t.openedBy !== user.id && !staff)) throw err("NOT_FOUND");
  const replies = await db.select().from(ticketReplies).where(and(eq(ticketReplies.ticketId, id), staff ? undefined : eq(ticketReplies.internal, false))).orderBy(ticketReplies.createdAt);
  return { ticket: t, replies };
}

export async function replyTicket(user: User, id: string, body: string, internal = false) {
  if (!body?.trim()) throw err("VALIDATION", "Message required", { field: "body" });
  const { ticket } = await getTicket(user, id);
  const staff = can(user, "tickets.manage");
  if (internal && !staff) throw err("FORBIDDEN");
  if (ticket.status === "resolved" && !staff) throw err("INVALID_TRANSITION", "Ticket is resolved");
  if (ticket.openedBy !== user.id && !staff) throw err("FORBIDDEN");
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(ticketReplies).values({ ticketId: id, authorId: user.id, authorRole: user.role, body, internal }).returning();
    const next = staff ? "in_review" : "open";
    await tx.update(tickets).set({ status: next, updatedAt: new Date(), assignedTo: staff ? user.id : ticket.assignedTo }).where(eq(tickets.id, id));
    if (staff && !internal) await notify(ticket.openedBy, "ticket_reply", { ref: ticket.ref }, tx);
    return r;
  });
}

export async function resolveTicket(user: User, id: string) {
  const { ticket } = await getTicket(user, id);
  if (ticket.openedBy !== user.id) requirePerm(user, "tickets.manage");
  const [u] = await db.update(tickets).set({ status: "resolved", updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
  await audit(user, "ticket.resolve", "ticket", id);
  return u;
}

// ───────── Complaints ─────────
export async function fileComplaint(user: User, i: { category: string; description: string; requestId?: string; offerId?: string }) {
  if (!["business", "driver", "office"].includes(user.role)) throw err("FORBIDDEN");
  if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(i.category)) throw err("VALIDATION", "Invalid category", { field: "category" });
  if (!i.description?.trim() || i.description.length < 10) throw err("VALIDATION", "Please describe the issue (min 10 chars)", { field: "description" });
  let requestId = i.requestId;
  const offerId = i.offerId;
  if (offerId) { const a = await jobAccess(user, offerId); requestId = a.request.id; }
  else if (requestId) {
    const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
    const mine = r && (r.businessId === user.id || (await db.select({ id: offers.id }).from(offers).where(and(eq(offers.requestId, requestId), or(eq(offers.driverId, user.id), eq(offers.officeId, user.id)))).limit(1)).length > 0);
    if (!mine) throw err("NOT_FOUND");
  }
  const priority = ["no_show", "damage"].includes(i.category) ? "urgent" : "normal";
  return db.transaction(async (tx) => {
    const c = await openComplaint(tx, user, { category: i.category, description: i.description, requestId, offerId, priority });
    const ops = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    await notifyMany(ops.map((o) => o.id), "complaint_filed", { ref: c.ref }, tx);
    return c;
  });
}

export async function listComplaints(user: User, f: { status?: string; page?: number } = {}) {
  const staff = can(user, "complaints.manage");
  const page = Math.max(f.page ?? 1, 1);
  const where = and(staff ? undefined : eq(complaints.filedBy, user.id), f.status ? eq(complaints.status, f.status) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select().from(complaints).where(where).orderBy(desc(complaints.createdAt)).limit(30).offset((page - 1) * 30),
    db.select({ total: count() }).from(complaints).where(where),
  ]);
  return { items, page, total: Number(total) };
}

export async function getComplaint(user: User, id: string) {
  const [c] = await db.select().from(complaints).where(eq(complaints.id, id));
  if (!c || (c.filedBy !== user.id && !can(user, "complaints.manage"))) throw err("NOT_FOUND");
  const notes = await db.select().from(complaintNotes).where(eq(complaintNotes.complaintId, id)).orderBy(complaintNotes.createdAt);
  return { complaint: c, notes };
}

const FLOW: Record<string, string[]> = { open: ["in_progress", "resolved"], in_progress: ["resolved", "open"], resolved: ["closed", "in_progress"], closed: [] };
export async function updateComplaint(staff: User, id: string, patch: { status?: string; resolution?: string; assignToMe?: boolean }) {
  requirePerm(staff, "complaints.manage");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(complaints).where(eq(complaints.id, id)).for("update");
    if (!c) throw err("NOT_FOUND");
    const set: Partial<typeof complaints.$inferInsert> = { updatedAt: new Date() };
    if (patch.assignToMe) { set.handlerId = staff.id; if (c.status === "open") set.status = "in_progress"; await tx.insert(complaintNotes).values({ complaintId: id, authorId: staff.id, authorRole: staff.role, kind: "assign", body: staff.name }); }
    if (patch.status && patch.status !== c.status) {
      if (!FLOW[c.status].includes(patch.status)) throw err("INVALID_TRANSITION", `${c.status} → ${patch.status} not allowed`);
      if (["resolved", "closed"].includes(patch.status) && !(patch.resolution?.trim() || c.resolution)) throw err("VALIDATION", "Resolution required", { field: "resolution" });
      set.status = patch.status;
      if (patch.status === "resolved") { set.resolvedAt = new Date(); set.holdsSettlement = false; }
      await tx.insert(complaintNotes).values({ complaintId: id, authorId: staff.id, authorRole: staff.role, kind: "status", body: `${c.status} → ${patch.status}` });
    }
    if (patch.resolution) set.resolution = patch.resolution;
    const [u] = await tx.update(complaints).set(set).where(eq(complaints.id, id)).returning();
    await audit(staff, "complaint.update", "complaint", id, patch, tx);
    if (set.status) await notify(c.filedBy, "complaint_update", { ref: c.ref, status: set.status }, tx);
    return u;
  });
}

export async function addComplaintNote(user: User, id: string, body: string) {
  if (!body?.trim()) throw err("VALIDATION", "Note required", { field: "body" });
  const { complaint } = await getComplaint(user, id);
  if (complaint.status === "closed") throw err("INVALID_TRANSITION", "Complaint is closed");
  const [n] = await db.insert(complaintNotes).values({ complaintId: id, authorId: user.id, authorRole: user.role, body }).returning();
  return n;
}

// ───────── Custody ─────────
export async function handoverCustody(user: User, offerId: string, items: Array<{ itemType: string; qty?: number; description?: string }>) {
  const a = await jobAccess(user, offerId);
  if (a.side !== "business") throw err("FORBIDDEN");
  if (!["attendance_confirmed", "delivered_reported"].includes(a.offer.status)) throw err("INVALID_TRANSITION", "Custody can be handed over after attendance is confirmed");
  if (!items.length || items.some((i) => !(CUSTODY_ITEM_TYPES as readonly string[]).includes(i.itemType) || (i.qty ?? 1) < 1)) throw err("VALIDATION", "Invalid custody items");
  return db.transaction(async (tx) => {
    const rows = await tx.insert(custodyItems).values(items.map((i) => ({ requestId: a.request.id, offerId, itemType: i.itemType, qty: i.qty ?? 1, description: i.description ?? null, handedOverBy: user.id }))).returning();
    await logEvent(tx, { requestId: a.request.id, offerId, actor: user, type: "custody_handover", payload: { items: items.length } });
    await notify(a.offer.driverId, "custody_handover", { ref: a.request.ref }, tx);
    return rows;
  });
}
export async function acknowledgeCustody(driver: User, itemId: string) {
  const [it] = await db.select({ i: custodyItems, d: offers.driverId }).from(custodyItems).innerJoin(offers, eq(offers.id, custodyItems.offerId)).where(eq(custodyItems.id, itemId));
  if (!it || it.d !== driver.id) throw err("NOT_FOUND");
  if (it.i.status !== "handed_over") throw err("INVALID_TRANSITION", `Item is ${it.i.status}`);
  const [u] = await db.update(custodyItems).set({ status: "acknowledged", acknowledgedAt: new Date() }).where(eq(custodyItems.id, itemId)).returning();
  return u;
}
export async function returnCustody(user: User, itemId: string, outcome: "returned" | "not_returned" | "damaged", note?: string) {
  const [it] = await db.select().from(custodyItems).where(eq(custodyItems.id, itemId));
  if (!it) throw err("NOT_FOUND");
  const a = await jobAccess(user, it.offerId);
  if (a.side !== "business" && !can(user, "custody.view")) throw err("FORBIDDEN");
  if (!["handed_over", "acknowledged"].includes(it.status)) throw err("INVALID_TRANSITION", `Item is ${it.status}`);
  if (outcome !== "returned" && !note?.trim()) throw err("VALIDATION", "Note required when not returned/damaged", { field: "note" });
  const [u] = await db.update(custodyItems).set({ status: outcome, returnedAt: new Date(), returnNote: note ?? null }).where(eq(custodyItems.id, itemId)).returning();
  await logEvent(db, { requestId: it.requestId, offerId: it.offerId, actor: user, type: `custody_${outcome}`, payload: { itemId } });
  return u;
}
export async function listCustody(user: User, offerId: string) {
  await jobAccess(user, offerId);
  return db.select().from(custodyItems).where(eq(custodyItems.offerId, offerId)).orderBy(custodyItems.createdAt);
}

// ───────── Job messages ─────────
export async function listMessages(user: User, offerId: string, since?: string) {
  await jobAccess(user, offerId);
  const rows = await db.select({ m: messages, name: users.name }).from(messages).innerJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.offerId, offerId), since ? sql`${messages.createdAt} > ${new Date(since)}` : undefined)).orderBy(messages.createdAt).limit(200);
  return rows.map((r) => ({ ...r.m, senderName: r.name }));
}
export async function postMessage(user: User, offerId: string, body: string) {
  const a = await jobAccess(user, offerId);
  const text = body?.trim();
  if (!text || text.length > 1000) throw err("VALIDATION", "Message must be 1–1000 characters", { field: "body" });
  if (a.side === "staff" && !can(user, "tickets.manage")) throw err("FORBIDDEN");
  if (["completed", "cancelled"].includes(a.request.status) && a.side !== "staff") throw err("INVALID_TRANSITION", "Job chat is closed");
  const [m] = await db.insert(messages).values({ requestId: a.request.id, offerId, senderId: user.id, senderRole: user.role, body: text }).returning();
  const recipients = [a.request.businessId, a.offer.driverId, a.offer.officeId].filter((x): x is string => !!x && x !== user.id);
  await notifyMany(recipients, "chat_message", { ref: a.request.ref, offerId }, db);
  return m;
}

// ───────── Notifications ─────────
export async function listNotifications(user: User, unreadOnly = false) {
  const rows = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), unreadOnly ? sql`${notifications.readAt} is null` : undefined)).orderBy(desc(notifications.createdAt)).limit(50);
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));
  return { items: rows, unread: Number(n) };
}
export async function markNotificationsRead(user: User, ids?: string[]) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`, ids?.length ? inArray(notifications.id, ids) : undefined));
}
