import { createHash } from "node:crypto";
import { DAY, HOUR, MIN, ksa, ksaDayStart } from "./calendar";
import { isOnline, shiftOf, worksDay } from "./schedule";
import { PLACEHOLDER_KEY, PLACEHOLDER_MIME } from "./placeholder";
import { REVIEW_NOTES_REJECT, USER_AGENTS } from "./names";
import { personPhone } from "./ids";
import { usernameFromEmail, usernameFromPhone } from "@/lib/username";
import type { Rng } from "./prng";
import type { Ctx, DriverSim, ActorRef } from "./types";
import type { Insert } from "./writer";

/**
 * Rows for the people: users (with the username they would sign in with; no password — nobody signs in as a generated person), profiles, wallets, documents and their
 * review history, agreements and invites, API keys, terms consents, sign-ins (username + password), driver availability and the audit trail of registrations, verifications and suspensions.
 * Accounts that already exist in the database (the demo accounts) are never rewritten: they only gain history.
 */
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const IP_BLOCKS = ["203.0.113", "198.51.100", "192.0.2"]; // documentation ranges: clearly not real customers
const ipFor = (rng: Rng, idx: number) => `${IP_BLOCKS[idx % 3]}.${(idx * 7) % 200 + 20 + rng.int(0, 20)}`;

interface LoginAgg { lastAt: number | null; count: number; ip: string | null; client: string | null }

/** Sign-in history of one user: how often they come back and a few mistakes (a wrong password now and then). */
function logins(ctx: Ctx, rng: Rng, o: { id: string; phone: string | null; email: string | null; name: string; role: string; from: number; to: number; everyDays: number; mobile: boolean; idx: number; suspendedAt: number | null }): LoginAgg {
  const agg: LoginAgg = { lastAt: null, count: 0, ip: null, client: null };
  if (o.to <= o.from) return agg;
  const ip = ipFor(rng, o.idx), staff = o.role === "staff" || o.role === "admin";
  const identifier = staff && o.email ? usernameFromEmail(o.email) : o.phone ? usernameFromPhone(o.phone) : o.email;
  const ua = () => rng.pick(o.mobile ? (rng.chance(0.65) ? USER_AGENTS.android : USER_AGENTS.ios) : USER_AGENTS.web);
  let t = o.from + rng.int(0, 90) * MIN;
  while (t < Math.min(o.to, ctx.asOf)) {
    // working hours: nobody signs in at 4 a.m.
    const h = ksa(t).hour;
    if (h < 6) t += (6 - h) * HOUR + rng.int(0, 90) * MIN; else if (h >= 23) t += (30 - h) * HOUR;
    if (staff) { const p = ksa(t); if (p.dow === 5 || p.dow === 6) t = ksaDayStart(t) + (7 - p.dow) * DAY + 8 * HOUR + rng.int(0, 90) * MIN; } // staff work Sunday–Thursday
    if (t >= Math.min(o.to, ctx.asOf)) break;
    const client = o.mobile ? "mobile" : "web";
    const fail = rng.chance(staff ? 0.03 : 0.045);
    if (fail) {
      const reason = "bad_password";
      ctx.sink.add("loginEvents", { id: ctx.ids.next("login"), userId: o.id, identifier, method: "password", success: false, failureReason: reason, ip, userAgent: ua(), client, sessionId: null, createdAt: new Date(t) });
      t += rng.int(1, 4) * MIN;
    }
    ctx.sink.add("loginEvents", { id: ctx.ids.next("login"), userId: o.id, identifier, method: "password", success: true, failureReason: null, ip, userAgent: ua(), client, sessionId: null, createdAt: new Date(t) });
    agg.lastAt = t; agg.count++; agg.ip = ip; agg.client = client;
    t += Math.round(rng.logNormal(o.everyDays, 0.5) * DAY) + rng.int(0, 6) * HOUR;
  }
  // a suspended account tries again and is turned away
  if (o.suspendedAt && o.suspendedAt < ctx.asOf && rng.chance(0.7)) ctx.sink.add("loginEvents", { id: ctx.ids.next("login"), userId: o.id, identifier, method: "password", success: false, failureReason: "suspended", ip, userAgent: ua(), client: o.mobile ? "mobile" : "web", sessionId: null, createdAt: new Date(Math.min(ctx.asOf - HOUR, o.suspendedAt + rng.int(1, 40) * HOUR)) });
  return agg;
}

type DocType = { type: string; years: number; required: boolean; p: number };
const DRIVER_DOCS: DocType[] = [{ type: "national_id", years: 6, required: true, p: 1 }, { type: "driving_license", years: 3, required: true, p: 1 }, { type: "vehicle_registration", years: 1.5, required: true, p: 1 }, { type: "vehicle_photo", years: 0, required: false, p: 0.6 }];
const OFFICE_DOCS: DocType[] = [{ type: "office_cr", years: 2, required: true, p: 1 }, { type: "office_license", years: 1.5, required: true, p: 1 }, { type: "iban_certificate", years: 0, required: false, p: 0.7 }];
const BUSINESS_DOCS: DocType[] = [{ type: "business_cr", years: 3, required: true, p: 1 }, { type: "tax_certificate", years: 1, required: false, p: 0.55 }];

/** Document submissions and their review: most approved at once, some rejected and re-sent, new accounts still waiting. */
function documents(ctx: Ctx, rng: Rng, o: { ownerId: string; kind: "driver" | "office" | "business"; createdAt: number; verifiedAt: number | null; verification: string; docs: DocType[]; /** driver whose licence ran out: the day it expired */ licenceExpiredOn?: string }) {
  const hr = ctx.w.staff.filter((s) => s.team === "hr");
  const reviewer = () => rng.pick(hr.length ? hr : [ctx.w.admin]);
  for (const d of o.docs) {
    if (!rng.chance(d.p)) continue;
    let at = o.createdAt + rng.int(2, 60) * MIN;
    const expires = o.licenceExpiredOn && d.type === "driving_license" ? o.licenceExpiredOn : d.years ? iso(at + Math.round(d.years * 365 * DAY * rng.float(0.4, 1.3))) : null;
    const mk = (status: string, rev: ActorRef | null, reviewedAt: number | null, note: string | null, when: number, exp: string | null) => {
      const id = ctx.ids.next("document");
      if (when > ctx.asOf) return;
      const decided = reviewedAt != null && reviewedAt <= ctx.asOf;
      const st = decided ? status : "submitted";
      ctx.sink.add("documents", { id, ownerId: o.ownerId, ownerKind: o.kind, type: d.type, storageKey: PLACEHOLDER_KEY, fileName: `${d.type}.png`, mime: PLACEHOLDER_MIME, size: rng.int(90, 900) * 1024, expiresOn: exp, status: st, reviewerId: decided ? rev?.id ?? null : null, reviewNote: decided ? note : null, reviewedAt: decided && reviewedAt ? new Date(reviewedAt) : null, createdAt: new Date(when) });
      if (decided && rev) ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: rev.id, actorRole: rev.role, action: status === "approved" ? "document.approved" : status === "rejected" ? "document.rejected" : "document.info_requested", entity: "document", entityId: id, diff: { type: d.type, note } as never, ip: null, correlationId: null, createdAt: new Date(reviewedAt!) });
    };
    const pendingAccount = o.verification === "pending" && !o.verifiedAt;
    const rejectedAccount = o.verification === "rejected";
    const rev = reviewer();
    const revActor = { id: rev.id, name: rev.name, role: rev.role };
    // the account is verified right after its last document is approved, never before
    const approvalAfter = (sent: number) => Math.max(sent + MIN, Math.min(sent + rng.int(1, 6) * HOUR, (o.verifiedAt ?? Infinity) - 5 * MIN));
    if (pendingAccount) { mk("approved", revActor, rng.chance(0.3) ? at + rng.int(2, 30) * HOUR : null, null, at, expires); continue; }
    if (rejectedAccount) { mk("rejected", revActor, at + rng.int(3, 40) * HOUR, rng.pick(REVIEW_NOTES_REJECT), at, expires); continue; }
    if (rng.chance(0.1)) { // rejected first, sent again, approved
      const t1 = at + rng.int(1, 5) * HOUR;
      mk("rejected", revActor, t1, rng.pick(REVIEW_NOTES_REJECT), at, expires);
      at = t1 + rng.int(1, 5) * HOUR;
      mk("approved", revActor, approvalAfter(at), null, at, expires);
    } else if (rng.chance(0.04)) { // the reviewer asked for a better copy; the new one is approved
      const t1 = at + rng.int(1, 5) * HOUR;
      mk("info_requested", revActor, t1, "Please send the full page, the corner is cut off.", at, expires);
      at = t1 + rng.int(1, 5) * HOUR;
      mk("approved", revActor, approvalAfter(at), null, at, expires);
    } else mk("approved", revActor, Math.max(at + MIN, (o.verifiedAt ?? at + 6 * HOUR) - rng.int(5, 90) * MIN), null, at, expires);
  }
}

function audit(ctx: Ctx, actor: { id: string; role: string } | null, action: string, entity: string, entityId: string, diff: Record<string, unknown> | null, at: number) {
  if (at > ctx.asOf) return;
  ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: actor?.id ?? null, actorRole: actor?.role ?? "system", action, entity, entityId, diff: diff as never, ip: null, correlationId: null, createdAt: new Date(at) });
}

export function emitAccounts(ctx: Ctx): void {
  const { sink, w, ids } = ctx;
  const seed = ctx.opts.seed;
  const rng = ctx.rng.fork("accounts");
  const hr = w.staff.filter((s) => s.team === "hr");
  const hrActor = () => { const s = rng.pick(hr.length ? hr : [w.admin]); return { id: s.id, name: s.name, role: s.role }; };
  const terms = (userId: string, role: string, at: number) => sink.add("termsConsents", { id: ids.next("terms"), userId, role, termsVersion: ctx.base.termsVersion, context: "registration", ip: null, acceptedAt: new Date(at) });
  const wallet = (id: string, owner: string, limit: number, at: number) => sink.add("walletAccounts", { id, ownerId: owner, kind: "user", availableCents: 0, reservedCents: 0, heldCents: 0, creditLimitCents: limit, updatedAt: new Date(at) });
  const verifyAudit = (id: string, vs: string, createdAt: number, verifiedAt: number | null, suspendedAt?: number | null) => {
    const a = hrActor();
    if ((vs === "verified" || vs === "suspended") && verifiedAt) audit(ctx, a, "account.verify", "user", id, { from: "pending", to: "verified" }, verifiedAt);
    if (vs === "rejected") audit(ctx, a, "account.reject", "user", id, { reason: "Documents could not be verified" }, createdAt + rng.int(4, 60) * HOUR);
    if (vs === "info_requested") audit(ctx, a, "account.request_info", "user", id, null, createdAt + rng.int(4, 60) * HOUR);
    if (vs === "suspended" && suspendedAt) audit(ctx, { id: w.admin.id, role: w.admin.role }, "account.suspend", "user", id, { reason: "Policy violation" }, suspendedAt);
  };
  const userRow = (id: string, role: string, name: string, phone: string | null, city: string, lang: string, createdAt: number, status: string, agg: LoginAgg): Insert<"users"> => ({
    id, role, phone, email: null, username: phone ? usernameFromPhone(phone) : null, passwordHash: null, name, language: lang, status, city, permissions: [], isDemo: false, source: "seed", createdBy: null, mustChangePassword: false,
    failedLogins: 0, lastLoginAt: agg.lastAt ? new Date(agg.lastAt) : null, lastSeenAt: agg.lastAt ? new Date(Math.min(ctx.asOf, agg.lastAt + rng.int(0, 6 * 60) * MIN)) : null, loginCount: agg.count, lastLoginIp: agg.ip, lastLoginClient: agg.client,
    createdAt: new Date(createdAt), updatedAt: new Date(Math.max(createdAt, agg.lastAt ?? createdAt)),
  });
  const reg = (id: string, name: string, createdAt: number, role: string) => { audit(ctx, { id, role }, "user.register", "user", id, { role }, createdAt); terms(id, role, createdAt); void name; };

  // ── staff: the demo staff exist; the seeder adds a few agents so rankings have more than five names ──
  w.staff.forEach((s, i) => {
    if (!s.existing) sink.add("users", { id: s.id, role: "staff", phone: null, email: s.email, username: usernameFromEmail(s.email), passwordHash: null, name: s.name, language: "en", status: "active", city: "riyadh", staffRole: s.staffRole, permissions: s.permissions, isDemo: false, source: "seed", mustChangePassword: false, failedLogins: 0, loginCount: 0, createdAt: new Date(s.createdAt), updatedAt: new Date(s.createdAt) });
    logins(ctx, rng.fork(`l:${s.id}`), { id: s.id, phone: null, email: s.email, name: s.name, role: s.role, from: s.existing ? ctx.windowStart : Math.max(ctx.windowStart, s.createdAt), to: ctx.asOf, everyDays: 1.3, mobile: false, idx: i, suspendedAt: null });
  });

  // ── offices ──
  w.offices.forEach((o, i) => {
    const agg = logins(ctx, rng.fork(`l:${o.id}`), { id: o.id, phone: o.phone, email: null, name: o.name, role: "office", from: Math.max(ctx.windowStart, (o.verifiedAt ?? o.createdAt)), to: ctx.asOf, everyDays: 5, mobile: false, idx: 100 + i, suspendedAt: o.status === "suspended" ? (o.agreementAt ?? o.createdAt) + 35 * DAY : null });
    if (o.existing) return;
    sink.add("users", userRow(o.id, "office", o.contact, o.phone, o.city, o.lang, o.createdAt, o.status, agg));
    wallet(o.walletId, o.id, 0, o.createdAt);
    reg(o.id, o.name, o.createdAt, "office");
    verifyAudit(o.id, o.verification, o.createdAt, o.verifiedAt, o.status === "suspended" ? (o.agreementAt ?? o.createdAt) + 35 * DAY : null);
    documents(ctx, rng, { ownerId: o.id, kind: "office", createdAt: o.createdAt, verifiedAt: o.verifiedAt, verification: o.verification, docs: OFFICE_DOCS });
    if (o.agreementAt && o.agreementAt <= ctx.asOf) {
      const v2 = rng.chance(0.3) ? Math.min(ctx.asOf - 5 * DAY, o.agreementAt + rng.int(60, 150) * DAY) : null;
      const adminId = w.admin.id;
      sink.add("officeAgreements", { id: ids.next("agreement"), officeId: o.id, version: 1, status: v2 && v2 < ctx.asOf ? "superseded" : "accepted", terms: "Standard courier office agreement v1", effectiveAt: new Date(o.agreementAt), expiresAt: new Date(o.agreementAt + 365 * DAY), createdBy: adminId, acceptedAt: new Date(o.agreementAt + rng.int(1, 30) * HOUR), createdAt: new Date(o.agreementAt - DAY) });
      if (v2 && v2 < ctx.asOf) sink.add("officeAgreements", { id: ids.next("agreement"), officeId: o.id, version: 2, status: "accepted", terms: "Renewed courier office agreement v2", effectiveAt: new Date(v2), expiresAt: new Date(v2 + 365 * DAY), createdBy: adminId, acceptedAt: new Date(v2 + rng.int(1, 40) * HOUR), createdAt: new Date(v2 - 2 * DAY) });
      audit(ctx, { id: adminId, role: w.admin.role }, "agreement.create", "user", o.id, { version: 1 }, o.agreementAt - DAY);
    }
  });

  // ── drivers ──
  const doc2 = new Set<string>();
  w.drivers.forEach((d, i) => {
    const from = Math.max(ctx.windowStart, d.verifiedAt ?? d.createdAt);
    const agg = logins(ctx, rng.fork(`l:${d.id}`), { id: d.id, phone: d.phone, email: null, name: d.name, role: "driver", from, to: Math.min(ctx.asOf, d.status === "suspended" ? (d.suspendedAt ?? ctx.asOf) : d.activeTo + 3 * DAY), everyDays: 24, mobile: true, idx: 200 + i, suspendedAt: d.suspendedAt });
    if (d.existing) return;
    sink.add("users", userRow(d.id, "driver", d.name, d.phone, d.city, d.lang, d.createdAt, d.status, agg));
    wallet(d.walletId, d.id, 0, d.createdAt);
    reg(d.id, d.name, d.createdAt, "driver");
    verifyAudit(d.id, d.verification === "expired" ? "verified" : d.verification, d.createdAt, d.verifiedAt, d.suspendedAt);
    if (d.status === "suspended" && d.suspendedAt) audit(ctx, { id: w.admin.id, role: w.admin.role }, "user.suspended", "user", d.id, null, d.suspendedAt);
    documents(ctx, rng, { ownerId: d.id, kind: "driver", createdAt: d.createdAt, verifiedAt: d.verifiedAt, verification: d.verification, docs: DRIVER_DOCS, licenceExpiredOn: d.verification === "expired" ? iso(d.activeTo) : undefined });
    void doc2;
  });
  // office invitations: accepted ones for every affiliation, plus a few answered otherwise
  for (const d of w.drivers) {
    if (d.existing) continue;
    for (const a of d.affiliations) {
      if (!a.officeId || a.from > ctx.asOf) continue;
      const invAt = a.from - rng.int(2, 60) * HOUR;
      sink.add("officeInvites", { id: ids.next("invite"), officeId: a.officeId, phone: d.phone, driverId: d.id, status: "accepted", createdAt: new Date(invAt), respondedAt: new Date(a.from) });
      audit(ctx, { id: a.officeId, role: "office" }, "office.link_driver", "user", d.id, { officeId: a.officeId }, a.from);
      if (Number.isFinite(a.to) && a.to <= ctx.asOf) audit(ctx, { id: a.officeId, role: "office" }, "office.unlink_driver", "user", d.id, { officeId: a.officeId }, a.to);
    }
  }
  for (const o of w.offices.filter((x) => !x.existing && x.agreementAt)) {
    const k = rng.int(1, 3);
    for (let n = 0; n < k; n++) {
      const at = (o.agreementAt ?? ctx.windowStart) + rng.int(2, 120) * DAY, st = rng.weighted([["declined", 4], ["pending", 3], ["cancelled", 2]] as const);
      if (at > ctx.asOf) continue;
      sink.add("officeInvites", { id: ids.next("invite"), officeId: o.id, phone: personPhone(ids.seq("phone")), driverId: null, status: st, createdAt: new Date(at), respondedAt: st === "pending" ? null : new Date(at + rng.int(1, 48) * HOUR) });
    }
  }

  // ── companies ──
  w.companies.forEach((c, i) => {
    const mobileUser = rng.chance(0.25);
    const agg = logins(ctx, rng.fork(`l:${c.id}`), { id: c.id, phone: c.phone, email: null, name: c.name, role: "business", from: Math.max(ctx.windowStart, c.verifiedAt ?? c.createdAt), to: Math.min(ctx.asOf, c.suspendedAt ?? c.activeTo + 14 * DAY), everyDays: c.size === "enterprise" ? 2.5 : c.size === "medium" ? 5 : 11, mobile: mobileUser, idx: 300 + i, suspendedAt: c.suspendedAt });
    if (c.existing) return;
    sink.add("users", userRow(c.id, "business", c.contact, c.phone, c.city, c.lang, c.createdAt, c.status, agg));
    wallet(c.walletId, c.id, c.creditLimitCents, c.createdAt);
    reg(c.id, c.name, c.createdAt, "business");
    verifyAudit(c.id, c.verification, c.createdAt, c.verifiedAt, c.suspendedAt);
    audit(ctx, { id: w.admin.id, role: w.admin.role }, "warehouse.location", "user", c.id, { lat: c.warehouse.lat, lng: c.warehouse.lng }, (c.verifiedAt ?? c.createdAt) + rng.int(1, 6) * HOUR);
    if (c.ops) audit(ctx, { id: w.admin.id, role: w.admin.role }, "warehouse.ops", "user", c.id, c.ops as never, (c.verifiedAt ?? c.createdAt) + rng.int(2, 30) * HOUR);
    if (c.creditLimitCents > 0) audit(ctx, { id: w.admin.id, role: w.admin.role }, "wallet.credit_limit", "user", c.id, { from: 0, to: c.creditLimitCents }, (c.verifiedAt ?? c.createdAt) + rng.int(24, 120) * HOUR);
    documents(ctx, rng, { ownerId: c.id, kind: "business", createdAt: c.createdAt, verifiedAt: c.verifiedAt, verification: c.verification, docs: BUSINESS_DOCS });
    if (c.apiKey && c.verifiedAt) {
      const at = c.verifiedAt + rng.int(1, 40) * DAY;
      if (at < ctx.asOf) sink.add("apiKeys", { id: ids.next("apiKey"), businessId: c.id, name: "Production", prefix: `jr_live_${createHash("sha256").update(c.id).digest("hex").slice(0, 6)}`, keyHash: createHash("sha256").update(`hist-key:${seed}:${c.id}`).digest("hex"), lastUsedAt: new Date(Math.max(at, ctx.asOf - rng.int(0, 3) * DAY)), createdAt: new Date(at) });
    }
  });
  // sign-ins of unknown people (typos, strangers) — the failure reasons the security views report on
  for (let k = 0; k < Math.round(ctx.days * 0.6); k++) {
    const at = ctx.windowStart + Math.floor(rng.next() * (ctx.asOf - ctx.windowStart));
    sink.add("loginEvents", { id: ids.next("login"), userId: null, identifier: usernameFromPhone(personPhone(90000 + rng.int(0, 9999))), method: "password", success: false, failureReason: rng.weighted([["unknown_user", 6], ["rate_limited", 1]] as const), ip: ipFor(rng, k), userAgent: rng.pick(USER_AGENTS.web), client: "web", sessionId: null, createdAt: new Date(at) });
  }
}

/** The office a driver works through at the end of the window (affiliations are kept as a timeline). */
function affiliationNow(ctx: Ctx, d: DriverSim): string | null {
  const a = d.affiliations.find((x) => ctx.asOf >= x.from && ctx.asOf < x.to);
  return a ? a.officeId : null;
}

/** Driver availability log: online / offline each working day (source `driver`), plus system and admin changes. */
function availability(ctx: Ctx, rng: Rng, d: DriverSim, seed: number): void {
  const log = (t: number, from: string | null, to: string, source: string, reason: string | null, actorId: string | null = null) => {
    if (t > ctx.asOf) return;
    ctx.sink.add("driverAvailabilityLog", { id: ctx.ids.next("availability"), driverId: d.id, fromStatus: from, toStatus: to, source, reason, actorId, at: new Date(t) });
  };
  const day0 = ksaDayStart(ctx.windowStart);
  let first = true;
  for (let day = day0; day < ctx.asOf; day += DAY) {
    if (!worksDay(d, seed, day)) continue;
    const s = shiftOf(d, day);
    if (s.from < d.activeFrom || s.from >= d.activeTo) continue;
    log(s.from + rng.int(0, 25) * MIN, first ? null : "unavailable", "available", "driver", "manual"); first = false;
    log(s.to + rng.int(-20, 40) * MIN, "available", "unavailable", "driver", "manual");
  }
  for (const s of ctx.suspensions.filter((x) => x.driverId === d.id)) {
    log(s.from, "available", "unavailable", "system", "cancel_strikes");
    audit(ctx, null, "driver.auto_suspend", "user", d.id, { cancellations: s.cancellations }, s.from);
  }
  if (d.status === "suspended" && d.suspendedAt) log(d.suspendedAt, "available", "unavailable", "admin", "suspended", ctx.w.admin.id);
  if (d.verification === "expired") log(d.activeTo, "available", "unavailable", "system", "document_expired");
}

/**
 * Phase B (after the simulation, because it needs what the simulation produced): profiles with rating / job counters, suspensions in force,
 * last known position and availability, plus the availability log and the audit trail of automatic suspensions.
 * The demo accounts that already exist are not rewritten — their counters are adjusted separately (see run.ts).
 */
export function emitProfiles(ctx: Ctx): void {
  const { sink, w } = ctx;
  const seed = ctx.opts.seed;
  const rng = ctx.rng.fork("profiles");
  for (const o of w.offices) {
    if (o.existing) continue;
    sink.add("officeProfiles", { userId: o.id, officeName: o.name, crNumber: o.cr, responsiblePerson: o.contact, address: o.address, city: o.city, bankName: o.bank, iban: o.iban, taxNumber: o.tax, verificationStatus: o.verification, verificationNote: o.verification === "rejected" ? "Commercial registration could not be verified" : o.verification === "suspended" ? "Suspended after repeated complaints" : null });
  }
  for (const d of w.drivers) {
    availability(ctx, rng, d, seed);
    if (d.existing) continue;
    const online = isOnline(d, seed, ctx.asOf);
    const now = affiliationNow(ctx, d);
    const lastSusp = d.strikeSuspensions.length ? Math.max(...d.strikeSuspensions.map((x) => x.to)) : 0;
    sink.add("driverProfiles", { userId: d.id, nationalId: d.nationalId, vehicleType: d.vehicleType, vehicleTemperature: d.temperature, vehiclePlate: d.plate, services: d.services, availability: online ? "available" : "unavailable", verificationStatus: d.verification, bankName: d.bank, iban: d.iban,
      officeId: now, officeLinkStatus: now ? "linked" : "direct", ratingSum: d.fin.ratingSum, ratingCount: d.fin.ratingCount, jobsCompleted: d.fin.jobsCompleted, suspendedUntil: lastSusp > ctx.asOf ? new Date(lastSusp) : null, lat: d.lastPing?.lat ?? null, lng: d.lastPing?.lng ?? null, locationAt: d.lastPing ? new Date(d.lastPing.t) : null });
  }
  for (const c of w.companies) {
    if (c.existing) continue;
    const secret = c.webhookUrl ? `whsec_${createHash("sha256").update(`${seed}:${c.id}`).digest("hex").slice(0, 32)}` : null;
    sink.add("businessProfiles", { userId: c.id, companyName: c.companyName, crNumber: c.cr, taxNumber: c.tax, industry: c.industry, address: c.address, responsiblePerson: c.contact,
      verificationStatus: c.verification, verificationNote: c.verification === "rejected" ? "Commercial registration could not be verified" : c.verification === "info_requested" ? "Please upload a clearer copy of the commercial registration" : c.verification === "suspended" ? "Suspended: unpaid obligations" : null,
      webhookUrl: c.webhookUrl, webhookSecret: secret, warehouseLat: c.warehouse.lat, warehouseLng: c.warehouse.lng, ops: c.ops as never, ratingSum: c.fin.ratingSum, ratingCount: c.fin.ratingCount });
  }
}
