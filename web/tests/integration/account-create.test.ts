/**
 * Staff create and edit accounts (decision G1 / G1a): POST /admin/accounts, PATCH /admin/accounts/:id, GET /admin/accounts/check, /office-options and /:id.
 * Pins the contract: a created account is exactly like a registered one (profile, wallet, invitations) but `source = 'admin'` and `created_by = staff`;
 * duplicates, validation, permissions, verified-at-creation (needs a reason), office affiliation, the audit trail, and that the person can then sign in with the username and password staff gave them.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, businessProfiles, driverProfiles, notifications, officeInvites, officeProfiles, termsConsents, users, walletAccounts } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkStaff } from "../helpers/factories";
import { call, loginWithPhone, login, TEST_PASSWORD } from "../helpers/api";
import { createSession } from "@/server/auth/session";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const send = async (u: { id: string }, method: string, path: string, body?: unknown) => call(method, path, { token: await tok(u), body });
const create = (u: { id: string }, body: unknown) => send(u, "POST", "/admin/accounts", body);
const patch = (u: { id: string }, id: string, body: unknown) => send(u, "PATCH", `/admin/accounts/${id}`, body);
const audits = (action: string, entityId: string) => db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)));
const IBAN = "SA0380000000608010167519";

const company = (o: Record<string, unknown> = {}) => ({ kind: "business", name: "Sara Ali", phone: "0501110001", city: "riyadh", companyName: "Alpha Trading", ...o });
const office = (o: Record<string, unknown> = {}) => ({ kind: "office", name: "Omar Nasser", phone: "0501110002", city: "jeddah", companyName: "Fast Couriers", ...o });
const driver = (o: Record<string, unknown> = {}) => ({ kind: "driver", name: "Khaled Saad", phone: "0501110003", city: "riyadh", vehicleType: "sedan", services: ["delivery_driver"], ...o });
const creator = () => mkStaff(["accounts.create", "accounts.edit"]);

describe("permissions", () => {
  it("only back-office staff holding accounts.create can create; everyone else is refused", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness(); const drv = await mkDriver();
    expect((await create(biz, company())).status).toBe(403);
    expect((await create(drv, company())).status).toBe(403);
    expect((await call("POST", "/admin/accounts", { body: company() })).status).toBe(401);
    expect((await create(await mkStaff(["users.view", "users.edit", "verification.manage"]), company())).status).toBe(403);
    expect((await create(await mkStaff(["accounts.create"]), company())).status).toBe(201);
    expect((await create(admin, company({ phone: "0501110099" }))).status).toBe(201);
  });
  it("editing needs accounts.edit, and reading the edit snapshot too", async () => {
    const target = await mkBusiness();
    const onlyCreate = await mkStaff(["accounts.create"]);
    expect((await patch(onlyCreate, target.id, { industry: "Food" })).status).toBe(403);
    expect((await send(onlyCreate, "GET", `/admin/accounts/${target.id}`)).status).toBe(403);
    expect((await patch(await mkStaff(["accounts.edit"]), target.id, { industry: "Food" })).status).toBe(200);
  });
});

describe("creating a company", () => {
  it("creates user, profile and wallet like a registration, marked as admin-created", async () => {
    const admin = await mkAdmin(); const staff = await creator();
    const r = await create(staff, company({ email: " Sara@Alpha.COM ", industry: "Retail", address: "Olaya St", crNumber: "1010123456", contactPerson: "Mona Hamad", lat: 24.7136, lng: 46.6753, language: "en" }));
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ user: { role: "business", name: "Sara Ali", phone: "+966501110001", email: "sara@alpha.com", city: "riyadh", language: "en", status: "active", source: "admin", createdBy: staff.id }, verification: "pending", sms: "skipped" });
    const id = r.json.user.id;
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({ source: "admin", createdBy: staff.id, role: "business", username: "u966501110001", mustChangePassword: true }); expect(u.passwordHash).toEqual(expect.any(String));
    const [p] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, id));
    expect(p).toMatchObject({ companyName: "Alpha Trading", industry: "Retail", address: "Olaya St", crNumber: "1010123456", responsiblePerson: "Mona Hamad", verificationStatus: "pending", warehouseLat: 24.7136, warehouseLng: 46.6753, ops: null });
    expect(await db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, id))).toHaveLength(1);
    expect(await db.select().from(termsConsents).where(eq(termsConsents.userId, id))).toHaveLength(0); // the terms are accepted on first use, never fabricated
    const [a] = await audits("account.create", id);
    expect(a).toMatchObject({ actorId: staff.id, actorRole: "staff", entity: "user" }); expect(a.diff).toMatchObject({ role: "business", source: "admin", verified: false });
    expect((await audits("warehouse.location", id)).length).toBe(1);
    const need = await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.type, "verification_needed")));
    expect(need).toHaveLength(1);
  });
  it("contact person defaults to the account holder and the pin is optional", async () => {
    const r = await create(await creator(), company());
    const [p] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, r.json.user.id));
    expect(p).toMatchObject({ responsiblePerson: "Sara Ali", warehouseLat: null, warehouseLng: null });
    expect(await audits("warehouse.location", r.json.user.id)).toHaveLength(0);
  });
  it("the new person signs in with the username and password they were given and is not asked to register", async () => {
    const r = await create(await creator(), company({ password: TEST_PASSWORD }));
    expect(r.json.credentials).toEqual({ username: "u966501110001", mustChangePassword: true }); // a typed password is never echoed back
    const signIn = await loginWithPhone("0501110001");
    expect(signIn.user).toMatchObject({ id: r.json.user.id, role: "business", mustChangePassword: true });
    const me = await call("GET", "/auth/me", { token: signIn.token });
    expect(me.status).toBe(200); expect(me.json.profile.companyName).toBe("Alpha Trading");
  });
});

describe("validation", () => {
  it("reports every problem at once, keyed by field", async () => {
    const r = await create(await creator(), { kind: "business", name: "S", phone: "12", city: "atlantis", email: "nope", crNumber: "<>" });
    expect(r.status).toBe(422);
    expect(Object.keys(r.json.error.details).sort()).toEqual(["city", "companyName", "crNumber", "email", "name", "phone"]);
  });
  it("rejects an unknown kind, unknown keys and fields of another kind", async () => {
    const staff = await creator();
    expect((await create(staff, { ...company(), kind: "staff" })).status).toBe(422);
    expect((await create(staff, { ...company(), role: "admin" })).status).toBe(422);
    const r = await create(staff, { ...company(), vehicleType: "van" });
    expect(r.status).toBe(422); expect(r.json.error.details.vehicleType).toBeTruthy();
  });
  it("applies the driver rules of a registration: vehicle, temperature, enabled services, IBAN", async () => {
    const staff = await mkStaff(["accounts.create", "drivers.sensitive"]);
    expect((await create(staff, driver({ vehicleType: "van" }))).json.error.details.vehicleTemperature).toBeTruthy();
    expect((await create(staff, driver({ vehicleType: "tank" }))).json.error.details.vehicleType).toBeTruthy();
    expect((await create(staff, driver({ services: [] }))).json.error.details.services).toBeTruthy();
    expect((await create(staff, driver({ services: ["teleport"] }))).json.error.details.services).toBeTruthy();
    expect((await create(staff, driver({ iban: "GB82WEST12345698765432" }))).json.error.details.iban).toBeTruthy();
    const ok = await create(staff, driver({ vehicleType: "dyna", vehicleTemperature: "cold", iban: "sa03 8000 0000 6080 1016 7519", bankName: "Al Rajhi", nationalId: "1087654321", vehiclePlate: "ABC 1234" }));
    expect(ok.status).toBe(201);
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, ok.json.user.id));
    expect(p).toMatchObject({ vehicleType: "dyna", vehicleTemperature: "cold", iban: IBAN, nationalId: "1087654321", vehiclePlate: "ABC 1234", availability: "unavailable", verificationStatus: "pending", officeId: null, officeLinkStatus: "direct", services: ["delivery_driver"] });
  });
  it("drops the temperature of a vehicle it does not apply to", async () => {
    const r = await create(await creator(), driver({ vehicleTemperature: "cold" }));
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, r.json.user.id));
    expect(p.vehicleTemperature).toBeNull();
  });
});

describe("duplicates", () => {
  it("refuses a phone or email that is already used (any spelling), without leaking who holds it", async () => {
    const staff = await creator(); const first = await create(staff, company({ email: "a@x.com" }));
    const phone = await create(staff, driver({ phone: "+966501110001" }));
    expect(phone.status).toBe(409); expect(phone.json.error.details).toMatchObject({ field: "phone" }); expect(phone.json.error.details.existing).toBeNull();
    const email = await create(staff, driver({ email: "A@X.com" }));
    expect(email.status).toBe(409); expect(email.json.error.details.field).toBe("email");
    const viewer = await mkStaff(["accounts.create", "users.view"]);
    const named = await create(viewer, driver({ phone: "٠٥٠١١١٠٠٠١" }));
    expect(named.status).toBe(409); expect(named.json.error.details.existing).toMatchObject({ id: first.json.user.id, role: "business", name: "Sara Ali" });
    expect(await db.select().from(users).where(eq(users.role, "driver"))).toHaveLength(0);
  });
  it("a staff member's own phone or email also counts as taken", async () => {
    const s = await mkStaff(["accounts.create"]); await db.update(users).set({ phone: "+966509998888" }).where(eq(users.id, s.id));
    expect((await create(s, company({ phone: "0509998888" }))).status).toBe(409);
    expect((await create(s, company({ email: s.email!.toUpperCase() }))).status).toBe(409);
  });
});

describe("GET /admin/accounts/check", () => {
  it("answers free, taken, invalid; names the account only to staff who may view users", async () => {
    const staff = await mkStaff(["accounts.create"]); const viewer = await mkStaff(["accounts.edit", "users.view"]);
    const made = await create(staff, company({ email: "a@x.com" }));
    const free = await send(staff, "GET", "/admin/accounts/check?phone=0507770000&email=free@x.com");
    expect(free.json).toMatchObject({ phone: { valid: true, normalized: "+966507770000", taken: false }, email: { valid: true, taken: false } });
    const taken = await send(staff, "GET", "/admin/accounts/check?phone=0501110001&email=A@x.com");
    expect(taken.json.phone).toMatchObject({ valid: true, taken: true, account: null }); expect(taken.json.email).toMatchObject({ taken: true, account: null });
    const named = await send(viewer, "GET", "/admin/accounts/check?phone=%2B966501110001");
    expect(named.json.phone.account).toMatchObject({ id: made.json.user.id, role: "business", name: "Sara Ali" });
    expect((await send(staff, "GET", "/admin/accounts/check?phone=123&email=bad")).json).toMatchObject({ phone: { valid: false, taken: false }, email: { valid: false, taken: false } });
    expect((await send(viewer, "GET", `/admin/accounts/check?phone=0501110001&exceptId=${made.json.user.id}`)).json.phone.taken).toBe(false); // an edit does not collide with itself
  });
  it("needs accounts.create or accounts.edit and does not reveal staff phones by name", async () => {
    const s = await mkStaff(["users.view"]); expect((await send(s, "GET", "/admin/accounts/check?phone=0501110001")).status).toBe(403);
    const other = await mkStaff(["accounts.create", "users.view"]); await db.update(users).set({ phone: "+966509998888" }).where(eq(users.id, (await mkStaff([])).id));
    const r = await send(other, "GET", "/admin/accounts/check?phone=0509998888");
    expect(r.json.phone).toMatchObject({ taken: true, account: null });
  });
});

describe("verified at creation", () => {
  it("needs verification.manage and a reason, then verifies the profile, audits the reason and tells the person", async () => {
    const admin = await mkAdmin(); const plain = await creator(); const hr = await mkStaff(["accounts.create", "verification.manage"]);
    expect((await create(plain, company({ verifyNow: { reason: "Checked in person" } }))).status).toBe(403);
    const noReason = await create(hr, company({ verifyNow: { reason: " " } }));
    expect(noReason.status).toBe(422); expect(noReason.json.error.details.verifyReason).toBeTruthy();
    const r = await create(hr, company({ verifyNow: { reason: "Checked in person" } }));
    expect(r.status).toBe(201); expect(r.json.verification).toBe("verified");
    const id = r.json.user.id;
    expect((await db.select().from(businessProfiles).where(eq(businessProfiles.userId, id)))[0]).toMatchObject({ verificationStatus: "verified", verificationNote: "Checked in person" });
    const [v] = await audits("account.verify", id); expect(v.diff).toMatchObject({ note: "Checked in person", via: "account.create" }); expect(v.actorId).toBe(hr.id);
    expect((await audits("account.create", id))[0].diff).toMatchObject({ verified: true });
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, id), eq(notifications.type, "verification_verified")))).toHaveLength(1);
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.type, "verification_needed")))).toHaveLength(0); // nothing to review
  });
  it("verifies an office (documents not checked, said so in the audit) and a driver", async () => {
    const hr = await mkStaff(["accounts.create", "verification.manage"]);
    const o = await create(hr, office({ verifyNow: { reason: "Known partner" } }));
    expect((await db.select().from(officeProfiles).where(eq(officeProfiles.userId, o.json.user.id)))[0].verificationStatus).toBe("verified");
    expect((await audits("account.verify", o.json.user.id))[0].diff).toMatchObject({ documentsNotChecked: true });
    const d = await create(hr, driver({ verifyNow: { reason: "Documents seen" } }));
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.json.user.id)))[0].verificationStatus).toBe("verified");
  });
});

describe("creating an office and the sensitive fields", () => {
  it("stores bank, tax and registration data of an office; the city goes on both rows", async () => {
    const staff = await mkStaff(["accounts.create", "drivers.sensitive"]);
    const r = await create(staff, office({ crNumber: "1010123456", taxNumber: "310122393500003", bankName: "Al Rajhi", iban: IBAN, address: "Madinah Rd", contactPerson: "Laila" }));
    expect(r.status).toBe(201);
    expect((await db.select().from(officeProfiles).where(eq(officeProfiles.userId, r.json.user.id)))[0]).toMatchObject({ officeName: "Fast Couriers", city: "jeddah", crNumber: "1010123456", taxNumber: "310122393500003", bankName: "Al Rajhi", iban: IBAN, responsiblePerson: "Laila", verificationStatus: "pending" });
    expect(r.json.profile.iban).toBe(IBAN); // the creator entered it and may see it
  });
  it("refuses payout and identity data without drivers.sensitive (and hides it in the response otherwise)", async () => {
    const staff = await creator();
    for (const body of [office({ iban: IBAN }), office({ taxNumber: "310122393500003" }), office({ bankName: "B" }), driver({ nationalId: "1087654321" })]) {
      const r = await create(staff, body); expect(r.status, JSON.stringify(body)).toBe(403); expect(r.json.error.details.field).toBeTruthy();
    }
    expect((await create(staff, office({ iban: "" }))).status).toBe(201); // empty is not "sending" it
  });
});

describe("driver in a courier office", () => {
  it("needs offices.manage; links the driver like an accepted invitation and audits it", async () => {
    const o = await mkOffice(); const plain = await creator(); const hr = await mkStaff(["accounts.create", "offices.manage"]);
    expect((await create(plain, driver({ officeId: o.id }))).status).toBe(403);
    const r = await create(hr, driver({ officeId: o.id }));
    expect(r.status).toBe(201);
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, r.json.user.id)))[0]).toMatchObject({ officeId: o.id, officeLinkStatus: "linked", availability: "unavailable" });
    const inv = await db.select().from(officeInvites).where(eq(officeInvites.driverId, r.json.user.id));
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ officeId: o.id, status: "accepted", phone: "+966501110003" });
    const [a] = await audits("office.link_driver", r.json.user.id); expect(a.diff).toMatchObject({ officeId: o.id, via: "account.create" });
  });
  it("refuses something that is not an active office, and an office id for a non-driver", async () => {
    const hr = await mkStaff(["accounts.create", "offices.manage"]); const biz = await mkBusiness(); const o = await mkOffice();
    expect((await create(hr, driver({ officeId: biz.id }))).json.error.details.officeId).toBeTruthy();
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, o.id));
    expect((await create(hr, driver({ officeId: o.id }))).status).toBe(422);
    expect((await create(hr, company({ officeId: o.id }))).status).toBe(422);
  });
  it("a pending invitation sent to the number becomes the new driver's own, like in a registration", async () => {
    const o = await mkOffice(); await db.insert(officeInvites).values({ officeId: o.id, phone: "+966501110003" });
    const r = await create(await creator(), driver());
    expect((await db.select().from(officeInvites).where(eq(officeInvites.phone, "+966501110003")))[0]).toMatchObject({ driverId: r.json.user.id, status: "pending" });
  });
  it("lists active offices for the picker (offices.manage only)", async () => {
    const a = await mkOffice(); const b = await mkOffice(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, b.id));
    expect((await send(await creator(), "GET", "/admin/accounts/office-options")).status).toBe(403);
    const r = await send(await mkStaff(["offices.manage"]), "GET", "/admin/accounts/office-options");
    expect(r.status).toBe(200); expect(r.json.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });
});

describe("text message", () => {
  it("never blocks creation: it reports demo mode, or that no provider is connected", async () => {
    const r = await create(await creator(), company({ sendSms: true }));
    expect(r.status).toBe(201); expect(["demo", "unavailable"]).toContain(r.json.sms);
    expect((await create(await creator(), company({ phone: "0501110077" }))).json.sms).toBe("skipped");
  });
});

describe("editing", () => {
  it("updates user and profile fields and audits a field-level diff; an unchanged save does nothing", async () => {
    const staff = await creator(); const made = await create(staff, company({ email: "a@x.com", industry: "Retail" })); const id = made.json.user.id;
    const r = await patch(staff, id, { name: "Sara A.", email: null, industry: "Food", companyName: "Alpha Foods", city: "jeddah", language: "ur", contactPerson: "Mona" });
    expect(r.status).toBe(200); expect(r.json.changed.sort()).toEqual(["city", "companyName", "contactPerson", "email", "industry", "language", "name"]);
    expect((await db.select().from(users).where(eq(users.id, id)))[0]).toMatchObject({ name: "Sara A.", email: null, city: "jeddah", language: "ur" });
    expect((await db.select().from(businessProfiles).where(eq(businessProfiles.userId, id)))[0]).toMatchObject({ companyName: "Alpha Foods", industry: "Food", responsiblePerson: "Mona" });
    const [a] = await audits("account.update", id);
    expect(a).toMatchObject({ actorId: staff.id }); expect((a.diff as { changes: Record<string, unknown> }).changes).toMatchObject({ industry: { from: "Retail", to: "Food" }, email: { from: "a@x.com", to: null } });
    const again = await patch(staff, id, { name: "Sara A.", industry: "Food" });
    expect(again.json.changed).toEqual([]); expect(await audits("account.update", id)).toHaveLength(1);
  });
  it("changes an office city on the profile as well", async () => {
    const staff = await creator(); const o = await create(staff, office()); await patch(staff, o.json.user.id, { city: "riyadh" });
    expect((await db.select().from(officeProfiles).where(eq(officeProfiles.userId, o.json.user.id)))[0].city).toBe("riyadh");
  });
  it("a phone change checks uniqueness, audits old and new and signs the person out everywhere", async () => {
    const staff = await creator(); const other = await create(staff, company({ phone: "0501110050" }));
    const made = await create(staff, company({ password: TEST_PASSWORD })); const id = made.json.user.id;
    const session = await loginWithPhone("0501110001");
    expect((await call("GET", "/auth/me", { token: session.token })).status).toBe(200);
    const clash = await patch(staff, id, { phone: "0501110050" });
    expect(clash.status).toBe(409); expect(clash.json.error.details.field).toBe("phone"); expect(other.status).toBe(201);
    expect((await call("GET", "/auth/me", { token: session.token })).status).toBe(200); // a refused change signs nobody out
    const r = await patch(staff, id, { phone: "0501110060" });
    expect(r.status).toBe(200); expect(r.json.sessionsRevoked).toBe(true);
    expect((await call("GET", "/auth/me", { token: session.token })).status).toBe(401);
    const [c] = await audits("account.phone_change", id); expect(c.diff).toEqual({ from: "+966501110001", to: "+966501110060" });
    expect(((await audits("account.update", id))[0].diff as { changes: Record<string, unknown> }).changes.phone).toEqual({ from: "+966501110001", to: "+966501110060" });
    expect((await login("u966501110001")).json.user.id).toBe(id); // the username stays; only the contact number changed
  });
  it("never edits staff or admins, never changes a role, and ignores malformed ids", async () => {
    const staff = await creator(); const admin = await mkAdmin(); const other = await mkStaff(["users.view"]); const biz = await mkBusiness();
    for (const t of [admin.id, other.id, staff.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) expect((await patch(staff, t, { name: "Hacked" })).status, t).toBe(404);
    expect((await send(staff, "GET", `/admin/accounts/${admin.id}`)).status).toBe(404);
    for (const body of [{ role: "admin" }, { status: "suspended" }, { permissions: ["staff.manage"] }, { kind: "driver" }]) expect((await patch(staff, biz.id, body)).status, JSON.stringify(body)).toBe(422);
    expect((await db.select().from(users).where(eq(users.id, admin.id)))[0].name).toBe("Admin");
  });
  it("sensitive fields need drivers.sensitive; an IBAN change is masked in the audit and notifies the owner", async () => {
    const plain = await creator(); const hr = await mkStaff(["accounts.edit", "drivers.sensitive"]); const d = await mkDriver();
    expect((await patch(plain, d.id, { iban: "SA6980000204608016211111" })).status).toBe(403);
    expect((await patch(plain, d.id, { nationalId: "1087654321" })).status).toBe(403);
    expect((await patch(plain, d.id, { vehiclePlate: "XYZ 9999" })).status).toBe(200);
    const r = await patch(hr, d.id, { iban: "SA6980000204608016211111", nationalId: "1087654321" }); expect(r.status).toBe(200);
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id)))[0]).toMatchObject({ iban: "SA6980000204608016211111", nationalId: "1087654321" });
    const diff = JSON.stringify((await audits("account.update", d.id)).map((a) => a.diff) ); expect(diff).not.toContain("SA6980000204608016211111"); expect(diff).toContain("…1111");
    expect(await audits("profile.iban_change", d.id)).toHaveLength(1);
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, d.id), eq(notifications.type, "iban_changed")))).toHaveLength(1);
  });
  it("hides personal data from the edit snapshot of staff without drivers.sensitive", async () => {
    const d = await mkDriver(); const plain = await creator(); const hr = await mkStaff(["accounts.edit", "drivers.sensitive"]);
    const a = await send(plain, "GET", `/admin/accounts/${d.id}`); expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ kind: "driver", sensitiveAllowed: false, phone: null, fields: { iban: null, bankName: null, nationalId: null, vehicleType: "sedan" } }); expect(a.json.phoneMasked).toContain("•••");
    const b = await send(hr, "GET", `/admin/accounts/${d.id}`);
    expect(b.json).toMatchObject({ sensitiveAllowed: true, phone: d.phone, fields: { iban: "SA0380000000608010167519" } });
  });
  it("driver edits keep the vehicle rules: a van needs a temperature, a sedan clears it", async () => {
    const staff = await creator(); const d = await mkDriver({ vehicle: "van", temp: "dry" });
    expect((await patch(staff, d.id, { vehicleTemperature: "cold" })).status).toBe(200);
    expect((await patch(staff, d.id, { vehicleType: "sedan" })).status).toBe(200);
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id)))[0]).toMatchObject({ vehicleType: "sedan", vehicleTemperature: null });
    expect((await patch(staff, d.id, { vehicleType: "dyna" })).json.error.details.vehicleTemperature).toBeTruthy();
    expect((await patch(staff, d.id, { services: [] })).status).toBe(422);
  });
  it("moving a warehouse pin needs users.edit, is validated, and cannot be removed", async () => {
    const biz = await mkBusiness(); const plain = await creator(); const full = await mkStaff(["accounts.edit", "users.edit"]);
    expect((await patch(plain, biz.id, { lat: 24.8, lng: 46.8 })).status).toBe(403);
    expect((await patch(full, biz.id, { lat: 99, lng: 46.8 })).status).toBe(422);
    expect((await patch(full, biz.id, { lat: null, lng: null })).json.error.details.lat).toBeTruthy();
    expect((await patch(full, biz.id, { lat: 24.8 })).status).toBe(200);
    expect((await db.select().from(businessProfiles).where(eq(businessProfiles.userId, biz.id)))[0]).toMatchObject({ warehouseLat: 24.8, warehouseLng: 46.6753 });
    expect(await audits("warehouse.location", biz.id)).toHaveLength(1);
  });
});
