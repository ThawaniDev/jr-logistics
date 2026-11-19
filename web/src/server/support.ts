import { and, desc, eq, ilike, inArray, or, sql, count } from "drizzle-orm";
import { contains } from "@/lib/sql";
import { db } from "@/db";
import {
  tickets, ticketReplies, ticketAttachments, complaints, complaintNotes, custodyItems, messages, notifications, users, offers, requests, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES, TICKET_CATEGORIES } from "./catalog";
import { can, requirePerm } from "./auth/permissions";
import { jobAccess } from "./access";
import { openTicket, openComplaint } from "./jobs";
import { notify, notifyMany, notifyOps } from "./notify";
import type { Exec } from "@/db";
import { audit } from "./audit";
import { hit } from "./auth/ratelimit";
import { storage } from "./storage";
import { matchesMime } from "./accounts";
import { randomToken } from "@/lib/ids";
import { logEvent } from "./events";

// ───────── Tickets ─────────
/** The caller must be the business that owns the request, or a driver/office that has an offer on it. */
async function assertRequestAccess(user: User, requestId: string) {
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  const mine = r && (r.businessId === user.id || (await db.select({ id: offers.id }).from(offers).where(and(eq(offers.requestId, requestId), or(eq(offers.driverId, user.id), eq(offers.officeId, user.id)))).limit(1)).length > 0);
  if (!mine) throw err("NOT_FOUND");
}

const ATTACH_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_ATTACH = 3, MAX_ATTACH_BYTES = 8 * 1024 * 1024;

/** Step 1 of attaching a file to a ticket message: stored unattached, linked when the message is posted (`attachmentIds`). */
export async function uploadTicketAttachment(user: User, f: { name: string; mime: string; data: Buffer }) {
  if (!ATTACH_MIME.includes(f.mime)) throw err("VALIDATION", "Attach a JPG, PNG, WebP or PDF file", { field: "file" });
  if (f.data.length > MAX_ATTACH_BYTES) throw err("VALIDATION", "File is larger than 8 MB", { field: "file" });
  if (f.data.length < 8 || !matchesMime(f.data, f.mime)) throw err("VALIDATION", "The file content does not match its type", { field: "file" });
  await hit(`ticket:upload:${user.id}`, 30, 3600);
  const [{ n }] = await db.select({ n: count() }).from(ticketAttachments).where(and(eq(ticketAttachments.uploadedBy, user.id), sql`${ticketAttachments.ticketId} is null`));
  if (Number(n) >= 10) throw err("RATE_LIMITED", "Too many unsent attachments — send or discard them first");
  const ext = f.mime === "image/png" ? "png" : f.mime === "image/webp" ? "webp" : f.mime === "application/pdf" ? "pdf" : "jpg";
  const key = `tickets/${user.id}/${randomToken(8)}.${ext}`;
  await storage().put(key, f.data);
  const name = f.name.replace(/[^\w.\- \u0600-\u06FF]/g, "_").slice(0, 80) || `file.${ext}`;
  const [row] = await db.insert(ticketAttachments).values({ uploadedBy: user.id, storageKey: key, name, mime: f.mime, size: f.data.length }).returning();
  return { id: row.id, name: row.name, mime: row.mime, size: row.size };
}

/** Links the caller's unattached uploads to a ticket (and the message that carries them); refuses anything that is not theirs / already used. */
async function attach(tx: Exec, user: User, ticketId: string, replyId: string, ids: string[] | undefined) {
  const list = [...new Set(ids ?? [])];
  if (!list.length) return;
  if (list.length > MAX_ATTACH) throw err("VALIDATION", `At most ${MAX_ATTACH} attachments per message`, { field: "attachmentIds" });
  const rows = await tx.select().from(ticketAttachments).where(and(inArray(ticketAttachments.id, list), eq(ticketAttachments.uploadedBy, user.id), sql`${ticketAttachments.ticketId} is null`)).for("update");
  if (rows.length !== list.length) throw err("VALIDATION", "An attachment was not found or was already sent — upload it again", { field: "attachmentIds" });
  await tx.update(ticketAttachments).set({ ticketId, replyId }).where(inArray(ticketAttachments.id, list));
}

export async function readTicketAttachment(user: User, id: string) {
  const [a] = await db.select({ a: ticketAttachments, opener: tickets.openedBy }).from(ticketAttachments).leftJoin(tickets, eq(tickets.id, ticketAttachments.ticketId)).where(eq(ticketAttachments.id, id));
  if (!a) throw err("NOT_FOUND");
  const mine = a.a.uploadedBy === user.id || a.opener === user.id;
  if (!mine && !(a.opener && can(user, "tickets.view"))) throw err("NOT_FOUND");
  return { data: await storage().get(a.a.storageKey), mime: a.a.mime, name: a.a.name };
}

export async function createTicket(user: User, i: { category: string; subject: string; body?: string; requestId?: string; offerId?: string; attachmentIds?: string[] }) {
  const allowed = (TICKET_CATEGORIES as Record<string, readonly string[]>)[user.role] ?? [];
  if (!allowed.includes(i.category)) throw err("VALIDATION", "Invalid category for your role", { field: "category" });
  if (!i.subject?.trim()) throw err("VALIDATION", "Subject required", { field: "subject" });
  let requestId = i.requestId;
  // An offer fixes the request it belongs to; a client-supplied request id must never point a ticket at someone else's request.
  if (i.offerId) requestId = (await jobAccess(user, i.offerId)).request.id;
  else if (requestId) await assertRequestAccess(user, requestId);
  return db.transaction(async (tx) => {
    const hasFiles = !!i.attachmentIds?.length;
    const t = await openTicket(tx, user, { ...i, requestId, body: i.body?.trim() || (hasFiles ? "" : i.body) });
    if (hasFiles) {
      let [first] = await tx.select().from(ticketReplies).where(eq(ticketReplies.ticketId, t.id)).orderBy(ticketReplies.createdAt).limit(1);
      if (!first) [first] = await tx.insert(ticketReplies).values({ ticketId: t.id, authorId: user.id, authorRole: user.role, body: "" }).returning();
      await attach(tx, user, t.id, first.id, i.attachmentIds);
    }
    if (t.priority !== "urgent") await notifyOps("tickets.manage", "ticket_new", { ref: t.ref }, tx); // urgent ones already notified in openTicket
    return t;
  });
}

export interface CaseFilter { status?: string; priority?: string; role?: string; q?: string; page?: number; pageSize?: number }
/** One parser for the list query strings of tickets and complaints (junk values fall back to "no filter"). */
export function ticketFilter(query: URLSearchParams): CaseFilter {
  const pr = query.get("priority");
  const role = query.get("role");
  return {
    status: query.get("status") || undefined, priority: pr === "normal" || pr === "urgent" ? pr : undefined, role: role === "business" || role === "driver" || role === "office" ? role : undefined,
    q: query.get("q")?.trim().slice(0, 80) || undefined, page: Math.max(1, Math.floor(Number(query.get("page"))) || 1),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(query.get("pageSize"))) || 30)),
  };
}

export async function listTickets(user: User, f: CaseFilter = {}) {
  const staff = can(user, "tickets.view");
  const page = Math.max(f.page ?? 1, 1), pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
  const q = f.q ? contains(f.q) : null;
  const where = and(staff ? undefined : eq(tickets.openedBy, user.id), f.status ? eq(tickets.status, f.status) : undefined, f.priority ? eq(tickets.priority, f.priority) : undefined, staff && f.role ? eq(users.role, f.role) : undefined,
    q ? or(ilike(tickets.ref, q), ilike(tickets.subject, q), ilike(users.name, q)) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ t: tickets, openedByName: users.name, openedByRole: users.role }).from(tickets).innerJoin(users, eq(users.id, tickets.openedBy)).where(where).orderBy(sql`(${tickets.priority} = 'urgent') desc`, desc(tickets.updatedAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(tickets).innerJoin(users, eq(users.id, tickets.openedBy)).where(where),
  ]);
  return { items: rows.map(({ t, openedByName, openedByRole }) => ({ ...t, openedByName, openedByRole })), page, pageSize, total: Number(total) };
}

export async function getTicket(user: User, id: string) {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  const staff = can(user, "tickets.view");
  if (!t || (t.openedBy !== user.id && !staff)) throw err("NOT_FOUND");
  const rows = await db.select().from(ticketReplies).where(and(eq(ticketReplies.ticketId, id), staff ? undefined : eq(ticketReplies.internal, false))).orderBy(ticketReplies.createdAt);
  const files = rows.length ? await db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId, id)) : [];
  const [assignee] = t.assignedTo ? await db.select({ name: users.name }).from(users).where(eq(users.id, t.assignedTo)) : [];
  const [opener] = await db.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, t.openedBy));
  const authors = rows.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))])) : [];
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));
  const replies = rows.map((r) => ({ ...r, authorName: r.authorRole === "driver" || r.authorRole === "business" || r.authorRole === "office" ? nameOf.get(r.authorId) ?? null : staff ? nameOf.get(r.authorId) ?? null : "JR Support", attachments: files.filter((f) => f.replyId === r.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })) }));
  return { ticket: { ...t, openedByName: staff ? opener?.name ?? null : undefined, openedByRole: staff ? opener?.role ?? null : undefined, assigneeName: staff ? assignee?.name ?? null : null }, replies };
}

export async function replyTicket(user: User, id: string, body: string, internal = false, attachmentIds?: string[]) {
  const text = (body ?? "").trim();
  if (!text && !attachmentIds?.length) throw err("VALIDATION", "Message required", { field: "body" });
  const { ticket } = await getTicket(user, id);
  const staff = can(user, "tickets.manage");
  if (internal && !staff) throw err("FORBIDDEN");
  if (ticket.status === "resolved" && !staff) throw err("INVALID_TRANSITION", "Ticket is resolved — reopen it to continue");
  if (ticket.openedBy !== user.id && !staff) throw err("FORBIDDEN");
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(ticketReplies).values({ ticketId: id, authorId: user.id, authorRole: user.role, body: text, internal }).returning();
    await attach(tx, user, id, r.id, attachmentIds);
    const next = internal ? ticket.status : staff ? "in_review" : "open";
    await tx.update(tickets).set({ status: next, updatedAt: new Date(), assignedTo: staff ? user.id : ticket.assignedTo }).where(eq(tickets.id, id));
    if (staff && !internal) await notify(ticket.openedBy, "ticket_reply", { ref: ticket.ref }, tx);
    // The customer wrote: the person handling it (or ops, while nobody is) is told.
    if (!staff) { if (ticket.assignedTo) await notify(ticket.assignedTo, "ticket_reply_user", { ref: ticket.ref }, tx); else await notifyOps("tickets.manage", "ticket_reply_user", { ref: ticket.ref }, tx); }
    return r;
  });
}

export async function resolveTicket(user: User, id: string) {
  const { ticket } = await getTicket(user, id);
  if (ticket.openedBy !== user.id) requirePerm(user, "tickets.manage");
  const [u] = await db.update(tickets).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
  if (ticket.openedBy !== user.id) await notify(ticket.openedBy, "ticket_resolved", { ref: ticket.ref });
  await audit(user, "ticket.resolve", "ticket", id);
  return u;
}

/** The person who opened a resolved ticket brings it back (within 14 days of the resolution), optionally with a message. */
export async function reopenTicket(user: User, id: string, body?: string, attachmentIds?: string[]) {
  const { ticket } = await getTicket(user, id);
  if (ticket.openedBy !== user.id) requirePerm(user, "tickets.manage");
  if (ticket.status !== "resolved") throw err("INVALID_TRANSITION", "Only a resolved ticket can be reopened");
  const since = ticket.resolvedAt ?? ticket.updatedAt;
  if (ticket.openedBy === user.id && Date.now() - since.getTime() > 14 * 864e5) throw err("INVALID_TRANSITION", "This ticket was resolved more than 14 days ago — please open a new one");
  return db.transaction(async (tx) => {
    const [u] = await tx.update(tickets).set({ status: "open", resolvedAt: null, updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
    if (body?.trim() || attachmentIds?.length) {
      const [r] = await tx.insert(ticketReplies).values({ ticketId: id, authorId: user.id, authorRole: user.role, body: body?.trim() ?? "" }).returning();
      await attach(tx, user, id, r.id, attachmentIds);
    }
    if (ticket.assignedTo) await notify(ticket.assignedTo, "ticket_reopened", { ref: ticket.ref }, tx); else await notifyOps("tickets.manage", "ticket_reopened", { ref: ticket.ref }, tx);
    await audit(user, "ticket.reopen", "ticket", id, null, tx);
    return u;
  });
}

/** Staff: status, priority and assignment of a ticket. */
export async function staffUpdateTicket(staff: User, id: string, patch: { status?: string; priority?: string; assignTo?: string | null; assignToMe?: boolean }) {
  requirePerm(staff, "tickets.manage");
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!t) throw err("NOT_FOUND");
  const set: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    if (!["open", "in_review", "resolved"].includes(patch.status)) throw err("VALIDATION", "Unknown status", { field: "status" });
    set.status = patch.status; set.resolvedAt = patch.status === "resolved" ? new Date() : null;
  }
  if (patch.priority !== undefined) { if (!["normal", "urgent"].includes(patch.priority)) throw err("VALIDATION", "Unknown priority", { field: "priority" }); set.priority = patch.priority; }
  if (patch.assignToMe) set.assignedTo = staff.id;
  else if (patch.assignTo !== undefined) {
    if (patch.assignTo) { const [a] = await db.select({ id: users.id, role: users.role, permissions: users.permissions }).from(users).where(and(eq(users.id, patch.assignTo), inArray(users.role, ["staff", "admin"]), eq(users.status, "active"))); if (!a) throw err("VALIDATION", "That person cannot take tickets", { field: "assignTo" }); }
    set.assignedTo = patch.assignTo;
  }
  return db.transaction(async (tx) => {
    const [u] = await tx.update(tickets).set(set).where(eq(tickets.id, id)).returning();
    if (patch.status === "resolved" && t.status !== "resolved") await notify(t.openedBy, "ticket_resolved", { ref: t.ref }, tx);
    await audit(staff, "ticket.update", "ticket", id, { from: { status: t.status, priority: t.priority, assignedTo: t.assignedTo }, patch }, tx);
    return u;
  });
}

/** Staff who can take tickets, for the assignment drop-down. */
export async function ticketAssignees(staff: User) {
  requirePerm(staff, "tickets.view");
  const rows = await db.select({ id: users.id, name: users.name, role: users.role, permissions: users.permissions }).from(users).where(and(inArray(users.role, ["staff", "admin"]), eq(users.status, "active")));
  return { items: rows.filter((r) => r.role === "admin" || r.permissions.includes("tickets.manage")).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)) };
}

// ───────── Complaints ─────────
export async function fileComplaint(user: User, i: { category: string; description: string; requestId?: string; offerId?: string }) {
  if (!["business", "driver", "office"].includes(user.role)) throw err("FORBIDDEN");
  if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(i.category)) throw err("VALIDATION", "Invalid category", { field: "category" });
  if (!i.description?.trim() || i.description.length < 10) throw err("VALIDATION", "Please describe the issue (min 10 chars)", { field: "description" });
  let requestId = i.requestId;
  const offerId = i.offerId;
  if (offerId) { const a = await jobAccess(user, offerId); requestId = a.request.id; }
  else if (requestId) await assertRequestAccess(user, requestId);
  const priority = ["no_show", "damage"].includes(i.category) ? "urgent" : "normal";
  return db.transaction(async (tx) => {
    const c = await openComplaint(tx, user, { category: i.category, description: i.description, requestId, offerId, priority });
    await notifyOps("complaints.manage", "complaint_filed", { ref: c.ref }, tx);
    return c;
  });
}

export async function listComplaints(user: User, f: CaseFilter = {}) {
  const staff = can(user, "complaints.manage");
  const page = Math.max(f.page ?? 1, 1), pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
  const q = f.q ? contains(f.q) : null;
  const where = and(staff ? undefined : eq(complaints.filedBy, user.id), f.status ? eq(complaints.status, f.status) : undefined, f.priority ? eq(complaints.priority, f.priority) : undefined,
    q ? or(ilike(complaints.ref, q), ilike(complaints.description, q), ilike(users.name, q)) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ c: complaints, filedByName: users.name }).from(complaints).innerJoin(users, eq(users.id, complaints.filedBy)).where(where).orderBy(desc(complaints.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(complaints).innerJoin(users, eq(users.id, complaints.filedBy)).where(where),
  ]);
  return { items: rows.map(({ c, filedByName }) => ({ ...c, filedByName })), page, pageSize, total: Number(total) };
}

export async function getComplaint(user: User, id: string) {
  const [c] = await db.select().from(complaints).where(eq(complaints.id, id));
  if (!c || (c.filedBy !== user.id && !can(user, "complaints.manage"))) throw err("NOT_FOUND");
  const notes = await db.select().from(complaintNotes).where(eq(complaintNotes.complaintId, id)).orderBy(complaintNotes.createdAt);
  return { complaint: c, notes };
}

const FLOW: Record<string, string[]> = { open: ["in_progress", "resolved"], in_progress: ["resolved", "open"], resolved: ["closed", "in_progress"], closed: [] };
export async function updateComplaint(staff: User, id: string, patch: { status?: string; resolution?: string; assignToMe?: boolean; assignTo?: string; holdsSettlement?: boolean }) {
  requirePerm(staff, "complaints.manage");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(complaints).where(eq(complaints.id, id)).for("update");
    if (!c) throw err("NOT_FOUND");
    const set: Partial<typeof complaints.$inferInsert> = { updatedAt: new Date() };
    if (patch.assignToMe) { set.handlerId = staff.id; if (c.status === "open") set.status = "in_progress"; await tx.insert(complaintNotes).values({ complaintId: id, authorId: staff.id, authorRole: staff.role, kind: "assign", body: staff.name }); }
    if (patch.assignTo && patch.assignTo !== c.handlerId) {
      const [h] = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.id, patch.assignTo), eq(users.status, "active")));
      if (!h || !["admin", "staff"].includes(h.role)) throw err("VALIDATION", "Pick an active staff member", { field: "assignTo" });
      set.handlerId = h.id; if (c.status === "open") set.status = "in_progress";
      await tx.insert(complaintNotes).values({ complaintId: id, authorId: staff.id, authorRole: staff.role, kind: "assign", body: h.name });
      await notify(h.id, "complaint_assigned", { ref: c.ref }, tx);
    }
    if (patch.holdsSettlement !== undefined && patch.holdsSettlement !== c.holdsSettlement) {
      if (patch.holdsSettlement && ["resolved", "closed"].includes(c.status)) throw err("INVALID_TRANSITION", "A resolved complaint cannot hold a settlement");
      set.holdsSettlement = patch.holdsSettlement;
      await tx.insert(complaintNotes).values({ complaintId: id, authorId: staff.id, authorRole: staff.role, kind: "status", body: patch.holdsSettlement ? "settlement hold on" : "settlement hold off" });
    }
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
  if (since !== undefined && Number.isNaN(new Date(since).getTime())) throw err("VALIDATION", "Invalid 'since' date", { field: "since" });
  const rows = await db.select({ m: messages, name: users.name }).from(messages).innerJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.offerId, offerId), since ? sql`${messages.createdAt} > ${new Date(since)}` : undefined)).orderBy(messages.createdAt).limit(200);
  return rows.map((r) => ({ ...r.m, senderName: r.name }));
}
export async function postMessage(user: User, offerId: string, body: string) {
  const a = await jobAccess(user, offerId);
  await hit(`chat:${user.id}`, 30, 60); // each message notifies the other parties: bound the spam
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
export async function listNotifications(user: User, unreadOnly = false, page = 1, pageSize = 30) {
  const where = and(eq(notifications.userId, user.id), unreadOnly ? sql`${notifications.readAt} is null` : undefined);
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(pageSize).offset((Math.max(page, 1) - 1) * pageSize);
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));
  const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
  return { items: rows, unread: Number(n), page: Math.max(page, 1), pageSize, total: Number(total) };
}
export async function markNotificationsRead(user: User, ids?: string[]) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`, ids?.length ? inArray(notifications.id, ids) : undefined));
}
