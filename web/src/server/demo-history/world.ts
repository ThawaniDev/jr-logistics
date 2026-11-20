import { STAFF_PRESETS } from "@/server/catalog";
import type { Baseline } from "./load";
import { DAY, HOUR, MIN } from "./calendar";
import { IdGen, personPhone, STAFF_EMAIL_DOMAIN } from "./ids";
import { WAREHOUSE_AREAS, jitter } from "./geo";
import { INDUSTRIES, companyName, driverName, officeName, saudiName, type Industry } from "./names";
import type { Rng } from "./prng";
import { clamp } from "./prng";
import type { CompanySim, DriverSim, OfficeSim, StaffSim, World } from "./types";

export interface BuildInput { rng: Rng; ids: IdGen; windowStart: number; asOf: number; base: Baseline; companies: number; offices: number; drivers: number }

const BANKS: ReadonlyArray<readonly [string, string]> = [["Al Rajhi Bank", "80"], ["SNB", "10"], ["Riyad Bank", "20"], ["Alinma Bank", "05"], ["Bank Albilad", "15"], ["SABB", "45"]];
const iban = (rng: Rng, code: string) => `SA${rng.int(10, 99)}${code}${Array.from({ length: 18 }, () => rng.int(0, 9)).join("")}`;
const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.int(0, 9)).join("");
const PLATE_LETTERS = "ABDEGHJKLNRSTUVXZ".split("");
const plate = (rng: Rng) => `${Array.from({ length: 3 }, () => rng.pick(PLATE_LETTERS)).join("")} ${rng.int(1000, 9999)}`;

const SIZE_LAMBDA = { enterprise: [1.7, 2.8], medium: [0.4, 0.8], small: [0.09, 0.25] } as const;
const SIZE_PARCELS = { enterprise: [7, 0.85], medium: [3.6, 0.7], small: [2.2, 0.6] } as const; // [median, sigma]

const VEHICLE_SUPPLY: ReadonlyArray<readonly [string, number]> = [["sedan", 50], ["dokker", 24], ["hiace", 8], ["van", 12], ["dyna", 6]];

export function buildWorld(b: BuildInput): World {
  const { rng, ids, windowStart, asOf, base } = b;
  const city = (r: Rng) => {
    // Pickup (and therefore matching) only exists in cities flagged `pickup`; everyone active lives there, the rest is a waiting list.
    const pickups = base.cities.filter((c) => c.pickup);
    return (pickups.length ? r.weighted(pickups.map((c, i) => [c.key, i === 0 ? 70 : 20] as const)) : "riyadh");
  };
  const otherCity = (r: Rng) => { const o = base.cities.filter((c) => !c.pickup); return o.length ? r.weighted(o.map((c, i) => [c.key, 1 / (1 + i * 0.6)] as const)) : "jeddah"; };
  const phoneSeq = () => personPhone(ids.seq("phone"));
  const userCities = new Map<string, string>();
  const reg = (rr: Rng, mustBeBeforeWindow: boolean, joinShare: number, spanDaysBefore = 150) => {
    // Registration moment: before the window (long-standing accounts) or inside it (growth).
    if (mustBeBeforeWindow || !rr.chance(joinShare)) return windowStart - rr.int(3, spanDaysBefore) * DAY + rr.int(0, 12) * HOUR;
    return windowStart + Math.floor(rr.next() ** 0.9 * (asOf - windowStart - 2 * DAY));
  };

  // ───── staff ─────
  const staff: StaffSim[] = [];
  const teamOf = (u: { role: string; staffRole: string | null }): StaffSim["team"] => (u.role === "admin" ? "admin" : u.staffRole === "finance" ? "finance" : u.staffRole === "hr_verification" ? "hr" : u.staffRole === "operations" ? "ops" : "support");
  for (const s of base.staff) staff.push({ id: s.id, name: s.name, role: s.role, email: s.email ?? "", staffRole: s.staffRole, permissions: s.permissions, existing: true, createdAt: s.createdAt.getTime(), team: teamOf(s) });
  const rs = rng.fork("staff");
  const addStaff = (name: string, staffRole: string, n: number) => {
    const id = ids.next("user");
    staff.push({ id, name, role: "staff", email: `${staffRole === "hr_verification" ? "hr" : staffRole}${n}@${STAFF_EMAIL_DOMAIN}`, staffRole, permissions: STAFF_PRESETS[staffRole], existing: false, createdAt: windowStart - 90 * DAY, team: teamOf({ role: "staff", staffRole }) });
  };
  addStaff(saudiName(rs, "en", true), "support", 2); addStaff(saudiName(rs, "en"), "support", 3); addStaff(saudiName(rs, "en"), "operations", 2);
  addStaff(saudiName(rs, "en", true), "finance", 3); addStaff(saudiName(rs, "en"), "hr_verification", 2);
  const admin = staff.find((s) => s.team === "admin") ?? staff.find((s) => s.team === "ops") ?? staff[0];

  // ───── offices ─────
  const offices: OfficeSim[] = [];
  const usedOffice = new Set<string>();
  const ro = rng.fork("offices");
  for (const e of base.offices) {
    offices.push({ idx: offices.length, id: e.id, name: e.officeName, contact: e.name, phone: e.phone ?? "", city: e.city ?? "riyadh", existing: true, lang: "en", createdAt: windowStart - 90 * DAY, verifiedAt: windowStart - 88 * DAY, verification: "verified", status: "active",
      iban: e.iban ?? "", bank: e.bankName ?? "", cr: e.cr ?? "", tax: "", address: "", agreementAt: windowStart - 87 * DAY, drivers: [], walletId: e.walletId });
    usedOffice.add(e.officeName);
  }
  for (let i = 0; i < b.offices; i++) {
    const r = ro.fork(i), bank = r.pick(BANKS);
    const createdAt = reg(r, i < Math.ceil(b.offices * 0.6), 0.5, 140);
    const pending = createdAt > asOf - 6 * DAY ? r.chance(0.8) : r.chance(0.05);
    const verifiedAt = pending ? null : Math.min(asOf, createdAt + r.logNormal(30, 0.6) * HOUR);
    const verification = pending || verifiedAt == null ? "pending" : r.chance(0.04) ? "rejected" : r.chance(0.03) ? "suspended" : "verified";
    const id = ids.next("user");
    const c = city(r);
    userCities.set(id, c);
    offices.push({ idx: offices.length, id, name: officeName(r, usedOffice), contact: saudiName(r, "en"), phone: phoneSeq(), city: c, existing: false, lang: r.chance(0.5) ? "ar" : "en", createdAt, verifiedAt: verification === "verified" || verification === "suspended" ? verifiedAt : null,
      verification, status: verification === "suspended" ? "suspended" : "active", iban: iban(r, bank[1]), bank: bank[0], cr: `1010${digits(r, 6)}`, tax: `3${digits(r, 13)}3`, address: `${r.int(1, 99)} ${r.pick(["Olaya St", "King Fahd Rd", "Al Urubah Rd"])}, ${c}`,
      agreementAt: verifiedAt ? verifiedAt + r.int(1, 3) * DAY : null, drivers: [], walletId: ids.next("wallet") });
  }

  // ───── drivers ─────
  const drivers: DriverSim[] = [];
  const rd = rng.fork("drivers");
  const vehicleOrder = (() => { // guarantee coverage of every vehicle type before sampling the mix
    const out: Array<[string, string | null]> = [];
    const want = b.drivers + base.drivers.length;
    const tmp = (v: string, r: Rng) => (v === "van" || v === "dyna" ? (r.chance(v === "van" ? 0.5 : 0.4) ? "cold" : "dry") : null);
    for (let i = 0; i < want; i++) { const v = i < 6 && b.drivers >= 12 ? (["sedan", "dokker", "hiace", "van", "dyna", "van"] as const)[i] : rd.weighted(VEHICLE_SUPPLY); out.push([v, tmp(v, rd)]); }
    return rd.shuffle(out);
  })();
  const mkDriver = (i: number, ex: Baseline["drivers"][number] | null): DriverSim => {
    const r = rd.fork(i);
    const q = (() => { const x = r.next(); return x < 0.07 ? r.float(0.05, 0.25) : x < 0.35 ? r.float(0.3, 0.65) : r.float(0.65, 1); })();
    // The demo drivers already exist in the database: only their simulated working life starts before the window (their rows are never rewritten).
    const createdAt = ex ? windowStart - r.int(60, 100) * DAY : reg(r, false, 0.5, 220);
    const [vehicle0, temp0] = vehicleOrder[drivers.length % vehicleOrder.length];
    const recent = createdAt > asOf - 4 * DAY;
    const roll = r.next();
    const verification: DriverSim["verification"] = ex ? "verified" : recent && r.chance(0.7) ? "pending" : roll < 0.9 ? "verified" : roll < 0.94 ? "pending" : roll < 0.96 ? "rejected" : "expired";
    const verifiedAt = verification === "pending" || verification === "rejected" ? null : Math.min(asOf, createdAt + (ex ? DAY : r.logNormal(26, 0.6) * HOUR));
    const suspended = verification === "verified" && !ex && r.chance(0.035);
    const suspendedAt = suspended ? Math.max(windowStart, (verifiedAt ?? createdAt) + r.int(5, 60) * DAY) : null;
    const churn = !suspended && verification === "verified" && !ex && r.chance(0.1);
    const lang = r.chance(0.55) ? "en" : "ar";
    const nWork = r.weighted([[5, 3], [6, 5], [7, 2]]);
    const off = r.shuffle([0, 1, 2, 3, 4, 5, 6]).sort((a, b2) => (a === 5 || a === 6 ? 1 : 0) - (b2 === 5 || b2 === 6 ? 1 : 0) + (r.next() - 0.5) * 0.6);
    const workDays = Array.from({ length: 7 }, (_, d) => off.indexOf(d) < nWork);
    const [shiftStart, shiftLen] = r.weighted<[number, number]>([[[6, 10], 22], [[7, 10], 22], [[9, 10], 22], [[12, 10], 16], [[15, 8], 12], [[17, 7], 6]]);
    const id = ex ? ex.id : ids.next("user");
    const bank = r.pick(BANKS);
    const name = ex ? ex.name : driverName(r);
    const activeFrom = Math.max(verifiedAt ?? Infinity, windowStart - 400 * DAY);
    const d: DriverSim = {
      idx: drivers.length, id, name, phone: ex?.phone ?? phoneSeq(), city: ex?.city ?? (verification === "verified" || verification === "expired" ? (r.chance(0.1) ? otherCity(r) : city(r)) : r.chance(0.5) ? city(r) : otherCity(r)), lang, existing: !!ex, // ~10 % of the verified drivers live in cities nobody can book a pickup in yet: supply the platform cannot match
      vehicleType: ex?.vehicleType ?? vehicle0, temperature: ex ? ex.vehicleTemperature : temp0, services: ex?.services?.length ? ex.services : r.chance(0.45) ? ["delivery_driver", "car_with_driver"] : ["delivery_driver"],
      plate: ex?.plate ?? plate(r), nationalId: ex?.nationalId ?? `${r.pick(["1", "2"])}${digits(r, 9)}`, iban: ex?.iban ?? iban(r, bank[1]), bank: ex?.bankName ?? bank[0],
      q, acceptBase: clamp(0.42 + 0.48 * q + r.normal(0, 0.07), 0.25, 0.94), respMedian: clamp(3 + (1 - q) * 16 + r.normal(0, 1.5), 1.5, 35),
      createdAt, verifiedAt, verification, status: suspended ? "suspended" : "active", suspendedAt,
      activeFrom: Number.isFinite(activeFrom) ? activeFrom : Infinity,
      activeTo: suspendedAt ?? (churn ? windowStart + Math.floor(r.float(0.25, 0.9) * (asOf - windowStart)) : Infinity),
      workDays, shiftStart, shiftLen, dayOn: clamp(0.8 + 0.18 * q + r.normal(0, 0.03), 0.68, 0.99),
      affiliations: [], jobs: [], cancels: [], strikeSuspensions: [], ratingSum: 0, ratingCount: 0, jobsCompleted: 0, fin: { ratingSum: 0, ratingCount: 0, jobsCompleted: 0 }, lastPing: null, lastOnlineState: false, walletId: ex ? ex.walletId : ids.next("wallet"),
    };
    // Hourly schedule fix: an old verified driver with no `activeFrom` yet still works from the window start.
    if (verification === "expired") d.activeTo = Math.max(d.activeFrom + DAY, asOf - r.int(1, 25) * DAY); // licence expired: off the road since
    userCities.set(id, d.city);
    return d;
  };
  for (const e of base.drivers) drivers.push(mkDriver(drivers.length, e));
  for (let i = 0; i < b.drivers; i++) drivers.push(mkDriver(drivers.length, null));

  // Affiliations: ~40 % of generated drivers work through an office (uneven office sizes); the demo drivers keep what the database says.
  const ra = rng.fork("affil");
  const readyOffices = offices.filter((o) => o.verification === "verified" || o.verification === "suspended");
  const weights = readyOffices.map((_, i) => [i, 1 / (1 + i * 0.55)] as const);
  for (const d of drivers) {
    const ex = base.drivers.find((e) => e.id === d.id);
    if (ex) { d.affiliations = [{ from: d.createdAt, to: Infinity, officeId: ex.officeId }]; continue; }
    if (readyOffices.length && ra.chance(0.4)) {
      const o = readyOffices[ra.weighted(weights)];
      const from = Math.max(d.createdAt + ra.int(0, 8) * DAY, (o.agreementAt ?? o.createdAt) + HOUR);
      if (ra.chance(0.12) && readyOffices.length > 1) { // moved office (or went direct) mid-window
        const moveAt = from + Math.floor(ra.float(0.25, 0.8) * Math.max(DAY, asOf - from));
        const other = ra.chance(0.4) ? null : readyOffices[(readyOffices.indexOf(o) + 1) % readyOffices.length].id;
        d.affiliations = [{ from: d.createdAt, to: from, officeId: null }, { from, to: moveAt, officeId: o.id }, { from: moveAt, to: Infinity, officeId: other }];
      } else d.affiliations = [{ from: d.createdAt, to: from, officeId: null }, { from, to: Infinity, officeId: o.id }];
    } else d.affiliations = [{ from: d.createdAt, to: Infinity, officeId: null }];
    // Office drivers need an active (verified) office to be matched: a driver of a suspended office stops with it.
  }
  for (const o of offices) o.drivers = drivers.filter((d) => d.affiliations.some((a) => a.officeId === o.id));

  // ───── companies ─────
  const companies: CompanySim[] = [];
  const rc = rng.fork("companies");
  const usedCo = new Set<string>(base.business.map((x) => x.companyName));
  const nEnt = Math.max(1, Math.round(b.companies * 0.1)), nMed = Math.round(b.companies * 0.23);
  const mk = (i: number, ex: Baseline["business"][number] | null, size: CompanySim["size"], forced?: Industry): CompanySim => {
    const r = rc.fork(i);
    const ind = forced ?? r.pick(INDUSTRIES);
    const cn = ex ? { display: ex.companyName, en: ex.companyName, ar: ex.companyName } : companyName(r, ind, usedCo);
    const [lamLo, lamHi] = SIZE_LAMBDA[size];
    const createdAt = ex ? windowStart - r.int(50, 90) * DAY : reg(r, size === "enterprise" && i % 2 === 0, size === "small" ? 0.55 : 0.3, 160);
    const recent = createdAt > asOf - 4 * DAY;
    const roll = r.next();
    const verification: CompanySim["verification"] = ex ? "verified" : recent && r.chance(0.75) ? "pending" : roll < 0.84 ? "verified" : roll < 0.87 ? "pending" : roll < 0.9 ? "info_requested" : roll < 0.94 ? "rejected" : "suspended";
    const verifiedAt = verification === "verified" || verification === "suspended" ? (ex ? createdAt + DAY : Math.min(asOf, createdAt + r.logNormal(20, 0.7) * HOUR)) : null;
    const suspendedAt = verification === "suspended" && verifiedAt ? Math.min(asOf - DAY, Math.max(verifiedAt, windowStart) + r.int(4, 70) * DAY) : null;
    const churnAt = !suspendedAt && verification === "verified" && !ex && size !== "enterprise" && r.chance(0.14) ? windowStart + Math.floor(r.float(0.3, 0.88) * (asOf - windowStart)) : null;
    const firstOrder = verifiedAt != null ? Math.max(verifiedAt, windowStart) + Math.floor(r.logNormal(1.2, 0.9) * DAY) : Infinity;
    const wh = ex && ex.lat != null && ex.lng != null ? { lat: ex.lat, lng: ex.lng, area: "Al Worood" } : (() => { const a = r.pick(WAREHOUSE_AREAS); const p = jitter(r, a[1], a[2], 0.7); return { ...p, area: a[0] }; })();
    const [med, sig] = SIZE_PARCELS[size];
    const veh = ind.vehicles;
    const idle = !ex && size === "small" && r.chance(0.12); // registered, verified, never really ordered
    const c: CompanySim = {
      idx: companies.length, id: ex ? ex.id : ids.next("user"), name: ex ? ex.name : saudiName(r, "en", r.chance(0.2)), phone: ex?.phone ?? phoneSeq(), city: ex?.city ?? (verification === "verified" || verification === "suspended" ? city(r) : r.chance(0.5) ? city(r) : otherCity(r)),
      existing: !!ex, lang: r.chance(0.45) ? "ar" : "en", companyName: cn.display, industry: ind.label, address: ex?.address ?? `${r.int(1, 240)} ${r.pick(["Olaya St", "King Fahd Rd", "Prince Sultan Rd", "Al Urubah Rd"])}, ${wh.area}`,
      cr: ex?.cr ?? `1010${digits(r, 6)}`, tax: `3${digits(r, 13)}3`, contact: ex ? ex.name : "", size, lambda: idle ? 0.01 : r.float(lamLo, lamHi),
      createdAt, verifiedAt, verification, status: verification === "suspended" ? "suspended" : "active", suspendedAt,
      activeFrom: firstOrder, activeTo: suspendedAt ?? churnAt ?? Infinity, warehouse: wh, ops: null, webhookUrl: null, apiKey: false, creditLimitCents: 0,
      codRate: clamp(ind.cod + r.normal(0, 0.08), 0.02, 0.85), b2bRate: clamp(ind.b2b + r.normal(0, 0.05), 0, 0.9), parcelMedian: med * ind.parcelScale, parcelSigma: sig,
      vehicleMix: veh, deliveryMix: [["riyadh", 78], ["jeddah", 11], ["dammam", 11]], contents: ind.contents, walletId: ex ? ex.walletId : ids.next("wallet"), requests: 0, fin: { ratingSum: 0, ratingCount: 0 },
    };
    if (!c.contact) c.contact = c.name;
    userCities.set(c.id, c.city);
    return c;
  };
  const exBiz = base.business;
  for (const e of exBiz) companies.push(mk(companies.length, e, "enterprise", INDUSTRIES.find((x) => x.key === "food")));
  for (let i = 0; i < b.companies; i++) companies.push(mk(companies.length, null, i < nEnt ? "enterprise" : i < nEnt + nMed ? "medium" : "small"));
  // Operating switches, webhooks, API clients, credit lines — a few accounts differ from the defaults, like in real life.
  const rx = rng.fork("company-ops");
  const gen = companies.filter((c) => !c.existing);
  const verifiedGen = gen.filter((c) => c.verification === "verified");
  for (const c of verifiedGen) {
    if (rx.chance(0.3)) c.ops = { ...(c.ops ?? {}), requireLoadingRecord: true };
    if (rx.chance(0.12)) c.ops = { ...(c.ops ?? {}), requireArrivalConfirmation: false };
  }
  const pharma = verifiedGen.find((c) => c.industry.startsWith("Pharmacy")) ?? verifiedGen[0];
  if (pharma) pharma.ops = { ...(pharma.ops ?? {}), requireSignature: true };
  const scanOnly = verifiedGen.find((c) => c !== pharma && c.size === "medium" && !c.ops?.requireSignature) ?? verifiedGen.find((c) => c !== pharma && c.size === "small");
  if (scanOnly) scanOnly.ops = { ...(scanOnly.ops ?? {}), requireDeliveryOtp: false };
  const enterprises = gen.filter((c) => c.size === "enterprise" && c.verification === "verified");
  enterprises.slice(0, 2).forEach((c, i) => { c.creditLimitCents = (i === 0 ? 60_000 : 30_000) * 100; });
  for (const c of [...gen.filter((c) => c.verification === "verified" && c.size === "medium" && c !== scanOnly && c !== pharma), ...gen.filter((c) => c.verification === "verified" && c.size === "enterprise")].slice(0, 3)) c.webhookUrl = `https://hooks.${c.companyName.replace(/[^A-Za-z]/g, "").toLowerCase().slice(0, 14) || "client"}.example/jr-webhook`;
  for (const c of verifiedGen) if (rx.chance(0.35)) c.apiKey = true;

  return { staff, admin, offices, drivers, companies, userCities, platformWalletId: base.platformWalletId };
}

/** Convenience for tests / reports. */
export const WORLD_MIN = MIN;
