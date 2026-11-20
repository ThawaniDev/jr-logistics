import { COMPLAINT_CATEGORIES, TICKET_CATEGORIES, URGENT_TICKET_CATEGORIES } from "@/server/catalog";
import { DAY, HOUR, MIN, ksa, ksaDayStart } from "./calendar";
import { refOf } from "./ids";
import { COMPLAINT_RESOLUTIONS, COMPLAINT_TEXTS, NOTE_TEXTS, STAFF_INTERNAL, STAFF_REPLIES, TICKET_TEXTS, USER_FOLLOWUPS } from "./names";
import { PLACEHOLDER_KEY, PLACEHOLDER_MIME } from "./placeholder";
import type { Rng } from "./prng";
import type { ComplaintSeed, Ctx, StaffSim, TicketSeed } from "./types";
import type { WithdrawalOut } from "./money";

/**
 * Support: tickets (with replies, internal notes, attachments metadata, first-response and resolution times, reopens), complaints (with notes and
 * settlement holds) and staff notes. The cases the lifecycle raised (no-shows, routes ended early, held payouts) come first; random everyday
 * cases are drawn on top, linked to real finished jobs.
 */
const BUSINESS_HOURS = (t: number) => { const p = ksa(t); return p.dow !== 5 && p.dow !== 6 && p.hour >= 7 && p.hour < 22; };
/** Support works Sunday–Thursday, 07:00–22:00 (urgent cases get a reply sooner, at any hour). */
function nextWorkingMoment(rng: Rng, t: number): number {
  let x = t;
  for (let i = 0; i < 9; i++) {
    if (BUSINESS_HOURS(x)) return x;
    const day = ksaDayStart(x), p = ksa(x);
    x = p.hour < 7 && p.dow !== 5 && p.dow !== 6 ? day + 7 * HOUR + rng.int(0, 60) * MIN : day + DAY + 7 * HOUR + rng.int(0, 60) * MIN;
  }
  return x;
}
const teamFor = (cat: string): StaffSim["team"] =>
  ["payment_issue", "cod_issue", "settlement_issue"].includes(cat) ? "finance" : ["documents"].includes(cat) ? "hr" : ["driver_no_show", "replacement_request", "urgent", "attendance_issue", "not_put_to_work", "business_not_ready", "driver_assignment", "shipment_count", "shipment_count_differs", "location_issue"].includes(cat) ? "ops" : "support";

interface Action { t: number; kind: "reply" | "internal" | "resolve" | "reopen" | "userReply"; staff?: StaffSim; body?: string }

export function emitSupport(ctx: Ctx, withdrawals: WithdrawalOut[]): void {
  const rng = ctx.rng.fork("support");
  const staffBy = (team: StaffSim["team"]) => { const l = ctx.w.staff.filter((s) => s.team === team); return l.length ? l : ctx.w.staff.filter((s) => s.team === "support" || s.team === "admin"); };
  const asOf = ctx.asOf;
  const names = new Map<string, { city: string; lang: "en" | "ar"; role: string }>();
  for (const c of ctx.w.companies) names.set(c.id, { city: c.city, lang: c.lang, role: "business" });
  for (const d of ctx.w.drivers) names.set(d.id, { city: d.city, lang: d.lang, role: "driver" });
  for (const o of ctx.w.offices) names.set(o.id, { city: o.city, lang: o.lang, role: "office" });

  // ── everyday cases drawn on top of the ones the lifecycle raised ──
  const jobs = ctx.jobRefs;
  const nTickets = Math.round(jobs.length * 0.12) + Math.round(ctx.w.companies.length * ctx.days / 20);
  for (let i = 0; i < nTickets; i++) {
    const j = jobs.length ? rng.pick(jobs) : null;
    const role = rng.weighted([["business", 58], ["driver", 32], ["office", 10]] as const);
    const userId = role === "business" ? (j?.businessId ?? rng.pick(ctx.w.companies).id) : role === "driver" ? (j?.driverId ?? rng.pick(ctx.w.drivers).id) : (j?.officeId ?? (ctx.w.offices.length ? rng.pick(ctx.w.offices).id : ""));
    if (!userId) continue;
    const cats = (TICKET_CATEGORIES as Record<string, readonly string[]>)[role];
    const category = rng.weighted(cats.map((c, k) => [c, c === "other" ? 3 : c === "app_problem" ? 4 : k < 3 ? 6 : 4] as const));
    const linked = j && rng.chance(0.55) && (role !== "office" || j.officeId === userId);
    const at = (linked ? j!.t : ctx.windowStart + Math.floor(rng.next() * (asOf - ctx.windowStart))) + Math.round(rng.logNormal(2, 1) * HOUR);
    if (at >= asOf) continue;
    ctx.ticketSeeds.push({ at, userId, role: role as "business" | "driver" | "office", category, requestId: linked ? j!.requestId : null, offerId: linked && role !== "business" ? j!.offerId : linked && rng.chance(0.5) ? j!.offerId : null, lang: names.get(userId)?.lang });
  }
  const nComplaints = Math.round(jobs.length * 0.04);
  for (let i = 0; i < nComplaints; i++) {
    const j = rng.pick(jobs);
    const role = rng.weighted([["business", 60], ["driver", 32], ["office", 8]] as const);
    const userId = role === "business" ? j.businessId : role === "driver" ? j.driverId : j.officeId;
    if (!userId) continue;
    const category = rng.weighted(COMPLAINT_CATEGORIES.map((c) => [c, c === "other" ? 2 : c === "delay" ? 8 : c === "service_quality" ? 6 : c === "payment" ? 5 : c === "behavior" ? 4 : c === "no_show" ? 3 : 2] as const));
    const at = j.t + Math.round(rng.logNormal(6, 1.1) * HOUR);
    if (at >= asOf) continue;
    ctx.complaintSeeds.push({ at, userId, role: role as "business" | "driver" | "office", category, requestId: j.requestId, offerId: j.offerId, priority: category === "no_show" || category === "damage" ? "urgent" : "normal", lang: names.get(userId)?.lang });
  }

  const requestRef = new Map<string, string>();
  for (const j of jobs) requestRef.set(j.requestId, j.ref);
  const noteTargets: Array<{ entity: string; id: string; at: number; to: number }> = [];

  // ── tickets ──
  for (const seed of ctx.ticketSeeds.slice().sort((a, b) => a.at - b.at)) {
    if (seed.at >= asOf) continue;
    ticket(ctx, rng, seed, staffBy, names, requestRef, noteTargets);
  }
  // ── complaints ──
  for (const seed of ctx.complaintSeeds.slice().sort((a, b) => a.at - b.at)) {
    if (seed.at >= asOf) continue;
    complaint(ctx, rng, seed, staffBy, names, noteTargets);
  }
  // ── notes on accounts, orders and withdrawals ──
  for (const c of ctx.w.companies.filter((x) => !x.existing && ["pending", "info_requested", "rejected", "suspended"].includes(x.verification))) if (rng.chance(0.8)) noteTargets.push({ entity: "user", id: c.id, at: c.createdAt + rng.int(2, 72) * HOUR, to: asOf });
  for (const d of ctx.w.drivers.filter((x) => !x.existing && (x.status === "suspended" || x.verification === "rejected" || x.verification === "expired" || x.q < 0.3))) if (rng.chance(0.7)) noteTargets.push({ entity: "user", id: d.id, at: Math.max(d.createdAt, ctx.windowStart) + rng.int(2, 60) * DAY, to: asOf });
  for (const c of ctx.w.companies.filter((x) => x.size === "enterprise")) noteTargets.push({ entity: "user", id: c.id, at: Math.max(c.createdAt, ctx.windowStart) + rng.int(1, 40) * DAY, to: asOf });
  for (const w of withdrawals.filter((x) => x.status === "rejected")) noteTargets.push({ entity: "withdrawal", id: w.id, at: w.decidedAt ?? w.createdAt, to: asOf });
  for (const j of rng.sample(jobs.filter((x) => x.failed >= 2), Math.min(30, jobs.length))) noteTargets.push({ entity: "request", id: j.requestId, at: j.t, to: asOf });
  for (const j of rng.sample(jobs, Math.min(Math.round(jobs.length * 0.012), 60))) {
    noteTargets.push({ entity: "offer", id: j.offerId, at: j.t, to: asOf });
    if (j.parcelId && rng.chance(0.5)) noteTargets.push({ entity: "shipment", id: j.parcelId, at: j.t, to: asOf });
  }
  const writers = ctx.w.staff.filter((s) => s.team !== "finance" || rng.chance(0.4));
  for (const nt of noteTargets) {
    if (!rng.chance(nt.entity === "ticket" ? 0.12 : nt.entity === "complaint" ? 0.3 : 0.9)) continue;
    const at = Math.min(asOf - MIN, nt.at + Math.round(rng.logNormal(6, 1) * HOUR));
    if (at < nt.at || at >= asOf) continue;
    const a = rng.pick(writers.length ? writers : [ctx.w.admin]);
    const entity = nt.entity;
    const texts = NOTE_TEXTS[entity] ?? NOTE_TEXTS.user;
    const nid = ctx.ids.next("note"), del = rng.chance(0.04);
    ctx.sink.add("entityNotes", { id: nid, entity, entityId: nt.id, authorId: a.id, body: rng.pick(texts), pinned: rng.chance(0.12), createdAt: new Date(at), deletedAt: del ? new Date(Math.min(asOf, at + rng.int(1, 40) * HOUR)) : null, deletedBy: del ? a.id : null });
    ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.id, actorRole: a.role, action: "note.add", entity, entityId: nt.id, diff: { noteId: nid, pinned: false } as never, ip: null, correlationId: null, createdAt: new Date(at) });
  }
}

type Names = Map<string, { city: string; lang: "en" | "ar"; role: string }>;

function ticket(ctx: Ctx, rng: Rng, seed: TicketSeed, staffBy: (t: StaffSim["team"]) => StaffSim[], names: Names, requestRef: Map<string, string>, notes: Array<{ entity: string; id: string; at: number; to: number }>) {
  const asOf = ctx.asOf, sink = ctx.sink;
  const info = names.get(seed.userId) ?? { city: "riyadh", lang: "en" as const, role: seed.role };
  const id = ctx.ids.next("ticket"), ref = refOf("ticket", ctx.ids.seq("ticket"));
  const urgent = seed.priority === "urgent" || URGENT_TICKET_CATEGORIES.includes(seed.category);
  const tpl = rng.pick(TICKET_TEXTS[seed.category] ?? TICKET_TEXTS.other);
  const lang = seed.lang ?? info.lang;
  const arabic = (t: { subject: string }) => /[\u0600-\u06FF]/.test(t.subject);
  const pool = (TICKET_TEXTS[seed.category] ?? TICKET_TEXTS.other).filter((t) => (lang === "ar") === arabic(t));
  const text = pool.length ? rng.pick(pool) : tpl;
  const rr = seed.requestId ? requestRef.get(seed.requestId) : null;
  const subject = seed.subject ?? (rr && rng.chance(0.5) ? `${rr}: ${text.subject}` : text.subject);
  const body = seed.body ?? text.body;
  const created = seed.at;
  const team = teamFor(seed.category), agents = staffBy(team);
  const agent = rng.pick(agents);
  const acts: Action[] = [];
  const delay = (urgent ? rng.logNormal(11, 0.9) : rng.logNormal(42, 1.0)) * MIN;
  let t = urgent ? created + delay : nextWorkingMoment(rng, created + delay);
  const nStaff = rng.weighted([[1, 4], [2, 4], [3, 2]] as const);
  for (let k = 0; k < nStaff; k++) {
    acts.push({ t, kind: "reply", staff: agent, body: rng.pick(STAFF_REPLIES) });
    if (k < nStaff - 1 || rng.chance(0.4)) { t = nextWorkingMoment(rng, t + Math.round(rng.logNormal(2.5, 0.9) * HOUR)); if (rng.chance(0.75)) acts.push({ t, kind: "userReply", body: rng.pick(USER_FOLLOWUPS) }); t = nextWorkingMoment(rng, t + Math.round(rng.logNormal(1.5, 0.9) * HOUR)); }
  }
  if (rng.chance(0.3)) acts.push({ t: Math.max(created + 5 * MIN, acts[0].t - rng.int(1, 30) * MIN) + 1, kind: "internal", staff: agent, body: rng.pick(STAFF_INTERNAL) });
  const lastT = Math.max(...acts.map((a) => a.t));
  const resolveAt = nextWorkingMoment(rng, lastT + Math.round(rng.logNormal(4, 1.0) * HOUR));
  const resolves = created < asOf - 21 * DAY || rng.chance(0.9); // anything older than three weeks has been closed by support
  if (resolves) acts.push({ t: resolveAt, kind: "resolve", staff: agent });
  let reopened = false;
  if (resolves && rng.chance(0.06)) {
    reopened = true;
    const tr = resolveAt + Math.round(rng.logNormal(20, 0.9) * HOUR);
    acts.push({ t: tr, kind: "reopen", body: rng.pick(USER_FOLLOWUPS) });
    const t2 = nextWorkingMoment(rng, tr + Math.round(rng.logNormal(80, 0.9) * MIN));
    acts.push({ t: t2, kind: "reply", staff: agent, body: rng.pick(STAFF_REPLIES) });
    acts.push({ t: nextWorkingMoment(rng, t2 + Math.round(rng.logNormal(5, 0.9) * HOUR)), kind: "resolve", staff: agent });
  }
  acts.sort((a, b) => a.t - b.t);

  // replay up to asOf
  let status = "open", assignedTo: string | null = null, resolvedAt: number | null = null, firstAt: number | null = null, firstBy: string | null = null, reopens = 0, updated = created;
  const replyRows: Array<{ id: string; t: number }> = [];
  const first = ctx.ids.next("reply");
  sink.add("ticketReplies", { id: first, ticketId: id, authorId: seed.userId, authorRole: info.role, body, internal: false, createdAt: new Date(created) });
  replyRows.push({ id: first, t: created });
  const intervals: Array<{ from: number; to: number }> = [];
  let openFrom: number | null = created;
  for (const a of acts) {
    if (a.t > asOf) break;
    updated = a.t;
    if (a.kind === "reply") {
      const wasResolved = status === "resolved";
      sink.add("ticketReplies", { id: ctx.ids.next("reply"), ticketId: id, authorId: a.staff!.id, authorRole: a.staff!.role, body: a.body!, internal: false, createdAt: new Date(a.t) });
      status = "in_review"; assignedTo = a.staff!.id;
      if (firstAt == null) { firstAt = a.t; firstBy = a.staff!.id; }
      if (wasResolved) { reopens++; openFrom = a.t; }
      ctx.sink.add("notifications", { id: ctx.ids.next("notification"), userId: seed.userId, type: "ticket_reply", title: "ticket_reply", body: null, data: { ref } as never, readAt: rng.chance(0.85) ? new Date(Math.min(asOf, a.t + rng.int(2, 600) * MIN)) : null, createdAt: new Date(a.t) });
    } else if (a.kind === "internal") {
      sink.add("ticketReplies", { id: ctx.ids.next("reply"), ticketId: id, authorId: a.staff!.id, authorRole: a.staff!.role, body: a.body!, internal: true, createdAt: new Date(a.t) });
      assignedTo = a.staff!.id;
    } else if (a.kind === "userReply") {
      sink.add("ticketReplies", { id: ctx.ids.next("reply"), ticketId: id, authorId: seed.userId, authorRole: info.role, body: a.body!, internal: false, createdAt: new Date(a.t) });
      status = status === "resolved" ? "resolved" : "open";
    } else if (a.kind === "resolve") {
      status = "resolved"; resolvedAt = a.t; assignedTo = assignedTo ?? a.staff!.id;
      if (firstAt == null) { firstAt = a.t; firstBy = a.staff!.id; }
      if (openFrom != null) { intervals.push({ from: openFrom, to: a.t }); openFrom = null; }
      sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.staff!.id, actorRole: a.staff!.role, action: "ticket.resolve", entity: "ticket", entityId: id, diff: null, ip: null, correlationId: null, createdAt: new Date(a.t) });
      sink.add("notifications", { id: ctx.ids.next("notification"), userId: seed.userId, type: "ticket_resolved", title: "ticket_resolved", body: null, data: { ref } as never, readAt: rng.chance(0.8) ? new Date(Math.min(asOf, a.t + rng.int(2, 900) * MIN)) : null, createdAt: new Date(a.t) });
    } else if (a.kind === "reopen") {
      status = "open"; resolvedAt = null; reopens++; openFrom = a.t;
      sink.add("ticketReplies", { id: ctx.ids.next("reply"), ticketId: id, authorId: seed.userId, authorRole: info.role, body: a.body!, internal: false, createdAt: new Date(a.t) });
      sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: seed.userId, actorRole: info.role, action: "ticket.reopen", entity: "ticket", entityId: id, diff: null, ip: null, correlationId: null, createdAt: new Date(a.t) });
    }
  }
  if (openFrom != null) intervals.push({ from: openFrom, to: Infinity });
  for (const iv of intervals) ctx.iv.tickets.push({ city: info.city, from: iv.from, to: iv.to });
  void reopened;
  sink.add("tickets", { id, ref, openedBy: seed.userId, requestId: seed.requestId ?? null, offerId: seed.offerId ?? null, category: seed.category, subject, priority: urgent ? "urgent" : "normal", status, assignedTo, resolvedAt: resolvedAt ? new Date(resolvedAt) : null, firstResponseAt: firstAt ? new Date(firstAt) : null, firstResponseBy: firstBy, reopenCount: reopens, createdAt: new Date(created), updatedAt: new Date(updated) });
  // attachments (metadata only: every one points at the same placeholder image)
  if (rng.chance(0.12)) {
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) sink.add("ticketAttachments", { id: ctx.ids.next("attachment"), uploadedBy: seed.userId, ticketId: id, replyId: first, storageKey: PLACEHOLDER_KEY, name: rng.pick(["screenshot.png", "photo.png", "receipt.png", "label.png"]), mime: PLACEHOLDER_MIME, size: rng.int(60, 800) * 1024, createdAt: new Date(created + k * 1000) });
  }
  notes.push({ entity: "ticket", id, at: created, to: asOf });
}

function complaint(ctx: Ctx, rng: Rng, seed: ComplaintSeed, staffBy: (t: StaffSim["team"]) => StaffSim[], names: Names, notes: Array<{ entity: string; id: string; at: number; to: number }>) {
  const asOf = ctx.asOf, sink = ctx.sink;
  const info = names.get(seed.userId) ?? { city: "riyadh", lang: "en" as const, role: seed.role };
  const id = ctx.ids.next("complaint"), ref = refOf("complaint", ctx.ids.seq("complaint"));
  const lang = seed.lang ?? info.lang;
  const texts = COMPLAINT_TEXTS[seed.category] ?? COMPLAINT_TEXTS.other;
  const description = seed.description ?? texts[lang === "ar" ? 1 % texts.length : 0];
  const handler = rng.pick(staffBy(seed.category === "payment" ? "finance" : "support"));
  const created = seed.at;
  const tAssign = nextWorkingMoment(rng, created + Math.round(rng.logNormal(2.5, 1.0) * HOUR));
  const tResolve = seed.resolveAt ?? nextWorkingMoment(rng, tAssign + Math.round(rng.logNormal(2.2, 0.9) * DAY));
  const closes = rng.chance(0.4), tClose = tResolve + Math.round(rng.logNormal(5, 0.6) * DAY);
  const resolves = seed.resolveAt != null || created < asOf - 45 * DAY || rng.chance(0.85);
  const note = (t: number, a: { id: string; role: string }, kind: string, body: string) => {
    if (t > asOf) return;
    sink.add("complaintNotes", { id: ctx.ids.next("complaintNote"), complaintId: id, authorId: a.id, authorRole: a.role, kind, body, createdAt: new Date(t) });
  };
  let status = "open", handlerId: string | null = null, resolution: string | null = null, resolvedAt: number | null = null, first: number | null = null, firstBy: string | null = null, updated = created;
  const hold = !!seed.holdsSettlement;
  let holds = hold;
  if (tAssign <= asOf) { status = "in_progress"; handlerId = handler.id; first = tAssign; firstBy = handler.id; updated = tAssign; note(tAssign, handler, "assign", handler.name); note(tAssign, handler, "status", "open → in_progress"); }
  const nNotes = rng.int(0, 3);
  for (let k = 0; k < nNotes; k++) {
    const t = tAssign + Math.round(((tResolve - tAssign) * (k + 1)) / (nNotes + 1)) + rng.int(0, 90) * MIN;
    if (t > asOf || t >= tResolve) continue;
    const byUser = rng.chance(0.3);
    note(t, byUser ? { id: seed.userId, role: info.role } : handler, "note", byUser ? rng.pick(USER_FOLLOWUPS) : rng.pick(STAFF_REPLIES));
    updated = Math.max(updated, t);
  }
  if (resolves && tResolve <= asOf) {
    status = "resolved"; resolvedAt = tResolve; resolution = rng.pick(COMPLAINT_RESOLUTIONS); holds = false; updated = tResolve; handlerId = handlerId ?? handler.id;
    if (first == null) { first = tResolve; firstBy = handler.id; }
    note(tResolve, handler, "status", "in_progress → resolved");
    sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: handler.id, actorRole: handler.role, action: "complaint.update", entity: "complaint", entityId: id, diff: { status: "resolved", resolution } as never, ip: null, correlationId: null, createdAt: new Date(tResolve) });
    sink.add("notifications", { id: ctx.ids.next("notification"), userId: seed.userId, type: "complaint_update", title: "complaint_update", body: null, data: { ref, status: "resolved" } as never, readAt: rng.chance(0.8) ? new Date(Math.min(asOf, tResolve + rng.int(5, 900) * MIN)) : null, createdAt: new Date(tResolve) });
    if (closes && tClose <= asOf) { status = "closed"; updated = tClose; note(tClose, handler, "status", "resolved → closed"); }
  }
  ctx.iv.complaints.push({ city: info.city, from: created, to: resolves && tResolve <= asOf ? tResolve : Infinity });
  sink.add("complaints", { id, ref, filedBy: seed.userId, filedByRole: seed.role, requestId: seed.requestId ?? null, offerId: seed.offerId ?? null, category: seed.category, description, priority: seed.priority ?? "normal", status, handlerId, resolution, resolvedAt: resolvedAt ? new Date(resolvedAt) : null, holdsSettlement: holds, firstResponseAt: first ? new Date(first) : null, firstResponseBy: firstBy, createdAt: new Date(created), updatedAt: new Date(updated) });
  notes.push({ entity: "complaint", id, at: created, to: asOf });
}
