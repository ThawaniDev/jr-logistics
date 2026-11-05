import { and, desc, eq, gte, inArray, lt, sql, count, sum, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  users, requests, offers, tickets, complaints, settlements, documents, driverProfiles, withdrawals, walletAccounts, auditLogs, custodyItems, businessProfiles, officeProfiles, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { OFFER_BUSY } from "./catalog";
import { getSettings } from "./settings";
import { audit } from "./audit";
import { requirePerm, can } from "./auth/permissions";
import { dispatchOffers, evaluateCandidates } from "./matching";
import { lockRequest } from "./requests";

// ───────── SLA (pure; unit-tested) ─────────
export type StartSla = "on_time" | "late" | "missed" | "at_risk" | "pending";
export function startSla(i: { startsAt: Date; arrivedAt: Date | null; status: string; now?: Date; graceMin: number }) {
  const now = i.now ?? new Date();
  const limit = new Date(i.startsAt.getTime() + i.graceMin * 60_000);
  if (i.arrivedAt) {
    const delayMin = Math.round((i.arrivedAt.getTime() - i.startsAt.getTime()) / 60_000);
    return { status: (i.arrivedAt <= limit ? "on_time" : "late") as StartSla, delayMin: Math.max(0, delayMin) };
  }
  if (i.status === "no_show") return { status: "missed" as StartSla, delayMin: null };
  if (["offered", "rejected", "expired", "cancelled", "replaced"].includes(i.status)) return { status: "pending" as StartSla, delayMin: null };
  return { status: (now > limit ? "at_risk" : "pending") as StartSla, delayMin: null };
}

// ───────── Dashboards ─────────
export async function adminStats() {
  const [byRole, byStatus, [t], [c], [v], [s], [w], [gmv]] = await Promise.all([
    db.select({ role: users.role, n: count() }).from(users).groupBy(users.role),
    db.select({ status: requests.status, n: count() }).from(requests).groupBy(requests.status),
    db.select({ n: count() }).from(tickets).where(inArray(tickets.status, ["open", "in_review"])),
    db.select({ n: count() }).from(complaints).where(inArray(complaints.status, ["open", "in_progress"])),
    db.select({ n: count() }).from(documents).where(inArray(documents.status, ["submitted", "under_review"])),
    db.select({ n: count(), amt: sum(settlements.providerCents) }).from(settlements).where(inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"])),
    db.select({ n: count() }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ g: sum(settlements.customerCents), m: sum(settlements.marginCents) }).from(settlements).where(eq(settlements.status, "paid")),
  ]);
  const [pendingBiz] = await db.select({ n: count() }).from(businessProfiles).where(inArray(businessProfiles.verificationStatus, ["pending", "info_requested"]));
  const [pendingOff] = await db.select({ n: count() }).from(officeProfiles).where(inArray(officeProfiles.verificationStatus, ["pending", "info_requested"]));
  const [pendingDrv] = await db.select({ n: count() }).from(driverProfiles).where(eq(driverProfiles.verificationStatus, "pending"));
  return {
    users: Object.fromEntries(byRole.map((r) => [r.role, Number(r.n)])),
    requests: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    openTickets: Number(t.n), openComplaints: Number(c.n), documentsToReview: Number(v.n),
    pendingSettlements: Number(s.n), pendingPayoutCents: Number(s.amt ?? 0), pendingWithdrawals: Number(w.n),
    pendingVerification: { business: Number(pendingBiz.n), office: Number(pendingOff.n), drivers: Number(pendingDrv.n) },
    gmvCents: Number(gmv.g ?? 0), marginCents: Number(gmv.m ?? 0),
  };
}

export async function businessOverview(biz: User) {
  const [byStatus, [spent]] = await Promise.all([
    db.select({ status: requests.status, n: count() }).from(requests).where(eq(requests.businessId, biz.id)).groupBy(requests.status),
    db.select({ s: sum(settlements.customerCents) }).from(settlements).where(and(eq(settlements.businessId, biz.id), eq(settlements.status, "paid"))),
  ]);
  const [bp] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, biz.id));
  return { requests: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])), totalSpentCents: Number(spent.s ?? 0), verificationStatus: bp?.verificationStatus ?? "pending", rating: bp?.ratingCount ? Math.round((bp.ratingSum / bp.ratingCount) * 10) / 10 : null };
}

// ───────── Operations queue ─────────
export async function opsAlerts() {
  const s = await getSettings();
  const now = new Date();
  const alerts: Array<{ type: string; severity: "critical" | "warning" | "info"; requestId?: string; offerId?: string; ref?: string; detail?: Record<string, unknown> }> = [];
  const late = await db.select({ o: offers, r: requests, d: users.name }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId))
    .where(and(eq(offers.status, "accepted"), lt(requests.startsAt, new Date(now.getTime() - s.lateGraceMin * 60_000))));
  for (const l of late) alerts.push({ type: "driver_late", severity: "critical", requestId: l.r.id, offerId: l.o.id, ref: l.r.ref, detail: { driver: l.d, startsAt: l.r.startsAt } });
  const unfilled = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`, lt(requests.startsAt, new Date(now.getTime() + 24 * 3600_000))));
  for (const r of unfilled) alerts.push({ type: "unfilled_soon", severity: r.slotsFilled === 0 ? "critical" : "warning", requestId: r.id, ref: r.ref, detail: { open: r.quantity - r.slotsFilled, startsAt: r.startsAt } });
  const unconfirmed = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(eq(offers.status, "delivered_reported"), lt(offers.deliveredAt, new Date(now.getTime() - 24 * 3600_000))));
  for (const u of unconfirmed) alerts.push({ type: "delivery_unconfirmed", severity: "warning", requestId: u.r.id, offerId: u.o.id, ref: u.r.ref });
  const disputes = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(eq(offers.status, "qty_disputed"));
  for (const d of disputes) alerts.push({ type: "qty_dispute", severity: "critical", requestId: d.r.id, offerId: d.o.id, ref: d.r.ref });
  const expiring = await db.select({ d: documents, u: users.name }).from(documents).innerJoin(users, eq(users.id, documents.ownerId))
    .where(and(eq(documents.status, "approved"), isNotNull(documents.expiresOn), sql`${documents.expiresOn} <= (current_date + 30)`)).limit(100);
  for (const e of expiring) alerts.push({ type: "doc_expiring", severity: e.d.expiresOn! < new Date().toISOString().slice(0, 10) ? "critical" : "info", detail: { owner: e.u, type: e.d.type, expiresOn: e.d.expiresOn } });
  const stale = await db.select({ n: count() }).from(settlements).where(and(eq(settlements.status, "pending_review"), lt(settlements.createdAt, new Date(now.getTime() - 24 * 3600_000))));
  if (Number(stale[0].n) > 0) alerts.push({ type: "settlement_pending", severity: "info", detail: { count: Number(stale[0].n) } });
  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export async function opsToday() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 864e5);
  const rows = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(gte(requests.startsAt, start), lt(requests.startsAt, end)));
  const c = (st: string[]) => rows.filter((x) => st.includes(x.o.status)).length;
  return {
    scheduled: rows.length, accepted: c(["accepted"]), arrived: c(["arrived"]), working: c(["attendance_confirmed"]),
    awaitingConfirmation: c(["delivered_reported"]), disputed: c(["qty_disputed"]), done: c(["pending_settlement", "completed"]), noShow: c(["no_show"]),
  };
}

// ───────── Live map (privacy: only drivers who opted-in by being available or on a job; views are audited) ─────────
export async function updateDriverLocation(driver: User, lat: number, lng: number) {
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw err("VALIDATION", "Invalid coordinates");
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
  const busy = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.driverId, driver.id), inArray(offers.status, OFFER_BUSY))).limit(1);
  if (p?.availability !== "available" && !busy.length) throw err("INVALID_TRANSITION", "Location sharing is only active while available or on a job");
  await db.update(driverProfiles).set({ lat, lng, locationAt: new Date() }).where(eq(driverProfiles.userId, driver.id));
}
export async function clearDriverLocation(driver: User) {
  await db.update(driverProfiles).set({ lat: null, lng: null, locationAt: null }).where(eq(driverProfiles.userId, driver.id));
}
export async function liveMap(staff: User) {
  requirePerm(staff, "live_location.view");
  const rows = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId))
    .where(and(isNotNull(driverProfiles.lat), sql`${driverProfiles.locationAt} > now() - interval '30 minutes'`));
  const busy = await db.select({ d: offers.driverId }).from(offers).where(inArray(offers.status, OFFER_BUSY));
  const busySet = new Set(busy.map((b) => b.d));
  await audit(staff, "location.view", "driver_location", null, { count: rows.length });
  return rows.map(({ u, p }) => ({ id: u.id, name: u.name, lat: p.lat, lng: p.lng, updatedAt: p.locationAt, city: u.city, status: busySet.has(u.id) ? "on_job" : "available" }));
}

// ───────── Ops actions ─────────
export async function smartSuggest(staff: User, requestId: string) {
  requirePerm(staff, "requests.assign", "requests.view");
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!r) throw err("NOT_FOUND");
  return (await evaluateCandidates(db, r)).slice(0, 50);
}
export async function rematch(staff: User, requestId: string) {
  requirePerm(staff, "replacements.manage", "requests.assign");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!["published", "filling"].includes(r.status)) throw err("INVALID_TRANSITION", `Request is ${r.status}`);
    const n = await dispatchOffers(tx, r, { replacement: r.slotsFilled > 0 });
    await audit(staff, "request.rematch", "request", requestId, { offers: n }, tx);
    return { offers: n };
  });
}

// ───────── Directory ─────────
export async function driverDirectory(staff: User, f: { q?: string; verification?: string; page?: number }) {
  requirePerm(staff, "drivers.view");
  const page = Math.max(f.page ?? 1, 1);
  const sensitive = can(staff, "drivers.sensitive");
  const rows = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId))
    .where(and(f.verification ? eq(driverProfiles.verificationStatus, f.verification) : undefined, f.q ? sql`(${users.name} ilike ${"%" + f.q + "%"} or ${users.phone} ilike ${"%" + f.q + "%"})` : undefined))
    .orderBy(desc(users.createdAt)).limit(50).offset((page - 1) * 50);
  return rows.map(({ u, p }) => ({
    id: u.id, name: u.name, phone: sensitive ? u.phone : u.phone?.replace(/\d(?=\d{3})/g, "•"), city: u.city, status: u.status,
    vehicleType: p.vehicleType, verificationStatus: p.verificationStatus, availability: p.availability, officeId: p.officeId,
    jobsCompleted: p.jobsCompleted, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, suspendedUntil: p.suspendedUntil, nationalId: sensitive ? p.nationalId : undefined,
  }));
}
export async function clearSuspension(staff: User, driverId: string) {
  requirePerm(staff, "users.edit");
  await db.update(driverProfiles).set({ suspendedUntil: null }).where(eq(driverProfiles.userId, driverId));
  await audit(staff, "driver.clear_suspension", "user", driverId);
}

// ───────── Reports (one definition, paginated, CSV-exportable) ─────────
export type ReportType = "requests" | "settlements" | "drivers" | "cancellations" | "sla" | "complaints" | "custody" | "withdrawals";
export async function report(staff: User, type: ReportType, f: { from?: Date; to?: Date; page?: number; pageSize?: number } = {}) {
  requirePerm(staff, "reports.view");
  const pageSize = Math.min(f.pageSize ?? 100, 1000), off = ((f.page ?? 1) - 1) * pageSize;
  const range = (col: Parameters<typeof gte>[0]) => and(f.from ? gte(col, f.from) : undefined, f.to ? lt(col, f.to) : undefined);
  const s = await getSettings();
  switch (type) {
    case "requests": {
      const rows = await db.select().from(requests).where(range(requests.createdAt)).orderBy(desc(requests.createdAt)).limit(pageSize).offset(off);
      return { columns: ["ref", "service", "status", "quantity", "pickupCity", "deliveryCity", "startsAt", "totalCents"], rows: rows.map((r) => ({ ref: r.ref, service: r.service, status: r.status, quantity: r.quantity, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt.toISOString(), totalCents: r.totalCents })) };
    }
    case "settlements": {
      requirePerm(staff, "finance.view");
      const rows = await db.select().from(settlements).where(range(settlements.createdAt)).orderBy(desc(settlements.createdAt)).limit(pageSize).offset(off);
      return { columns: ["id", "status", "finalUnits", "customerCents", "providerCents", "marginCents", "vatCents", "createdAt", "paidAt"], rows: rows.map((r) => ({ id: r.id, status: r.status, finalUnits: r.finalUnits, customerCents: r.customerCents, providerCents: r.providerCents, marginCents: r.marginCents, vatCents: r.vatCents, createdAt: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null })) };
    }
    case "cancellations": {
      const rows = await db.select({ r: requests, o: offers }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(inArray(offers.status, ["cancelled", "no_show", "replaced"]), range(offers.cancelledAt))).orderBy(desc(offers.cancelledAt)).limit(pageSize).offset(off);
      return { columns: ["ref", "status", "reason", "at"], rows: rows.map(({ r, o }) => ({ ref: r.ref, status: o.status, reason: o.cancelReason, at: o.cancelledAt?.toISOString() ?? null })) };
    }
    case "sla": {
      const rows = await db.select({ r: requests, o: offers, d: users.name }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId)).where(range(requests.startsAt)).orderBy(desc(requests.startsAt)).limit(pageSize).offset(off);
      return { columns: ["ref", "driver", "startsAt", "arrivedAt", "startStatus", "delayMin"], rows: rows.map(({ r, o, d }) => { const x = startSla({ startsAt: r.startsAt, arrivedAt: o.arrivedAt, status: o.status, graceMin: s.lateGraceMin }); return { ref: r.ref, driver: d, startsAt: r.startsAt.toISOString(), arrivedAt: o.arrivedAt?.toISOString() ?? null, startStatus: x.status, delayMin: x.delayMin }; }) };
    }
    case "complaints": {
      const rows = await db.select().from(complaints).where(range(complaints.createdAt)).orderBy(desc(complaints.createdAt)).limit(pageSize).offset(off);
      return { columns: ["ref", "category", "priority", "status", "createdAt", "resolvedAt"], rows: rows.map((c) => ({ ref: c.ref, category: c.category, priority: c.priority, status: c.status, createdAt: c.createdAt.toISOString(), resolvedAt: c.resolvedAt?.toISOString() ?? null })) };
    }
    case "custody": {
      const rows = await db.select().from(custodyItems).where(range(custodyItems.createdAt)).orderBy(desc(custodyItems.createdAt)).limit(pageSize).offset(off);
      return { columns: ["itemType", "qty", "status", "createdAt", "returnedAt"], rows: rows.map((c) => ({ itemType: c.itemType, qty: c.qty, status: c.status, createdAt: c.createdAt.toISOString(), returnedAt: c.returnedAt?.toISOString() ?? null })) };
    }
    case "withdrawals": {
      requirePerm(staff, "finance.view");
      const rows = await db.select().from(withdrawals).where(range(withdrawals.createdAt)).orderBy(desc(withdrawals.createdAt)).limit(pageSize).offset(off);
      return { columns: ["id", "amountCents", "status", "createdAt", "paymentRef"], rows: rows.map((w) => ({ id: w.id, amountCents: w.amountCents, status: w.status, createdAt: w.createdAt.toISOString(), paymentRef: w.paymentRef })) };
    }
    case "drivers": {
      const rows = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).orderBy(desc(users.createdAt)).limit(pageSize).offset(off);
      return { columns: ["name", "city", "vehicleType", "verificationStatus", "jobsCompleted", "rating"], rows: rows.map(({ u, p }) => ({ name: u.name, city: u.city, vehicleType: p.vehicleType, verificationStatus: p.verificationStatus, jobsCompleted: p.jobsCompleted, rating: p.ratingCount ? +(p.ratingSum / p.ratingCount).toFixed(1) : null })) };
    }
  }
}
/** CSV with formula-injection protection. */
export function toCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

export async function auditTrail(staff: User, f: { entity?: string; page?: number }) {
  requirePerm(staff, "audit.view");
  const page = Math.max(f.page ?? 1, 1);
  return db.select().from(auditLogs).where(f.entity ? eq(auditLogs.entity, f.entity) : undefined).orderBy(desc(auditLogs.createdAt)).limit(100).offset((page - 1) * 100);
}
export { walletAccounts };
