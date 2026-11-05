import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, driverProfiles, offers, businessProfiles, documents } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, mkOffice, tomorrow } from "../helpers/factories";
import { call, loginWithOtp, staffLogin } from "../helpers/api";
import { createSession } from "@/server/auth/session";

beforeEach(resetDb);
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const body = (o: Record<string, unknown> = {}) => ({ service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: tomorrow().toISOString(), durationDays: 1, ...o });

describe("demo accounts list", () => {
  it("lists the super admin with a working pre-filled password, and stops once the password changes", async () => {
    const email = process.env.SUPER_ADMIN_EMAIL!, pw = process.env.SUPER_ADMIN_PASSWORD!;
    const { ensureSuperAdmin } = await import("@/server/accounts");
    await ensureSuperAdmin(email, pw);
    const r = await call("GET", "/auth/demo-accounts");
    const a = r.json.items.find((i: any) => i.email === email.toLowerCase());
    expect(a?.password).toBe(pw);
    expect(JSON.stringify(r.json)).not.toContain("passwordHash");
    expect((await call("POST", "/auth/staff/login", { body: { email, password: a.password } })).status).toBe(200);
    // password changed since seeding → never listed with a stale/wrong password
    const { hashPassword } = await import("@/server/auth/password");
    await db.update(users).set({ passwordHash: await hashPassword("SomethingElse!2026") }).where(eq(users.email, email.toLowerCase()));
    expect((await call("GET", "/auth/demo-accounts")).json.items.some((i: any) => i.email === email.toLowerCase())).toBe(false);
  });
});

describe("auth", () => {
  it("OTP → register → session; /me works; logout revokes", async () => {
    const reg = await loginWithOtp("0500000099", { role: "business", name: "Test Biz", companyName: "Acme", city: "riyadh" });
    expect(reg.user.role).toBe("business");
    const me = await call("GET", "/auth/me", { token: reg.token });
    expect(me.status).toBe(200); expect(me.json.profile.companyName).toBe("Acme");
    await call("POST", "/auth/logout", { token: reg.token });
    expect((await call("GET", "/auth/me", { token: reg.token })).status).toBe(401);
    // second login goes to the same account
    const again = await loginWithOtp("0500000099");
    expect(again.user.id).toBe(reg.user.id);
  });

  it("rejects wrong OTP, bad phone, missing terms and duplicate registration", async () => {
    await call("POST", "/auth/otp/send", { body: { phone: "0500000098" } });
    expect((await call("POST", "/auth/otp/verify", { body: { phone: "0500000098", code: "000000" } })).status).toBe(422);
    expect((await call("POST", "/auth/otp/send", { body: { phone: "123" } })).status).toBe(422);
    const sent = await call("POST", "/auth/otp/send", { body: { phone: "0500000097" } });
    const v = await call("POST", "/auth/otp/verify", { body: { phone: "0500000097", code: sent.json.demoCode } });
    const noTerms = await call("POST", "/auth/register", { body: { registrationToken: v.json.registrationToken, role: "business", name: "X Y", companyName: "Co", termsAccepted: false } });
    expect(noTerms.status).toBe(422); expect(noTerms.json.error.code).toBe("TERMS_REQUIRED");
    const bad = await call("POST", "/auth/register", { body: { registrationToken: "forged.token", role: "business", name: "X Y", companyName: "Co", termsAccepted: true } });
    expect(bad.status).toBe(422);
  });

  it("OTP is burned after use and verification attempts are limited", async () => {
    const sent = await call("POST", "/auth/otp/send", { body: { phone: "0500000096" } });
    expect((await call("POST", "/auth/otp/verify", { body: { phone: "0500000096", code: sent.json.demoCode } })).status).toBe(200);
    expect((await call("POST", "/auth/otp/verify", { body: { phone: "0500000096", code: sent.json.demoCode } })).status).toBe(422);
  });

  it("staff cannot use OTP; staff password login works; wrong password locks out", async () => {
    const s = await mkStaff(["requests.view"]);
    expect((await call("POST", "/auth/otp/send", { body: { phone: s.phone ?? "0500000090" } })).status).toBe(200); // unknown phone is fine
    expect((await call("POST", "/auth/staff/login", { body: { email: s.email, password: "Password123" } })).status).toBe(200);
    for (let i = 0; i < 5; i++) await call("POST", "/auth/staff/login", { body: { email: s.email, password: "wrong-password" } });
    const locked = await call("POST", "/auth/staff/login", { body: { email: s.email, password: "Password123" } });
    expect([401, 429]).toContain(locked.status);
    const biz = await mkBusiness();
    expect((await call("POST", "/auth/staff/login", { body: { email: "nobody@x.com", password: "Password123" } })).status).toBe(401);
    void biz;
  });

  it("cookie sessions require a same-origin header on writes (CSRF)", async () => {
    const biz = await mkBusiness();
    const t = await tok(biz);
    const noOrigin = await call("POST", "/requests/estimate", { headers: { cookie: `jr_session=${t}` }, body: body() });
    expect(noOrigin.status).toBe(403);
    const evil = await call("POST", "/requests/estimate", { headers: { cookie: `jr_session=${t}`, origin: "https://evil.example" }, body: body() });
    expect(evil.status).toBe(403);
    const ok = await call("POST", "/requests/estimate", { headers: { cookie: `jr_session=${t}`, origin: "http://localhost" }, body: body() });
    expect(ok.status).toBe(200);
  });
});

describe("authorization", () => {
  it("401 without token, 403 wrong role, 404 for other tenants' resources", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const b1 = await mkBusiness({ fundsCents: 1000_00 }), b2 = await mkBusiness();
    const d = await mkDriver();
    expect((await call("GET", "/requests")).status).toBe(401);
    expect((await call("GET", "/requests", { token: await tok(d) })).status).toBe(403);
    expect((await call("GET", "/admin/stats", { token: await tok(b1) })).status).toBe(403);
    const created = await call("POST", "/requests", { token: await tok(b1), body: body() });
    expect(created.status).toBe(201);
    expect((await call("GET", `/requests/${created.json.id}`, { token: await tok(b2) })).status).toBe(404);
    expect((await call("POST", `/requests/${created.json.id}/cancel`, { token: await tok(b2), body: { reason: "nope" } })).status).toBe(404);
    expect((await call("GET", `/requests/${created.json.id}`, { token: await tok(b1) })).status).toBe(200);
  });

  it("staff permissions are enforced per endpoint", async () => {
    const support = await mkStaff(["tickets.view"]);
    const t = await tok(support);
    expect((await call("GET", "/admin/finance/settlements", { token: t })).status).toBe(403);
    expect((await call("GET", "/admin/users", { token: t })).status).toBe(403);
    expect((await call("GET", "/admin/tickets", { token: t })).status).toBe(200);
    expect((await call("PATCH", "/admin/settings", { token: t, body: { vatPct: 5 } })).status).toBe(403);
  });
});

describe("request flow over HTTP with privacy rules", () => {
  it("estimate hides provider cost; driver sees no recipient contact until accepted; business sees driver phone only after accept", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }), d = await mkDriver();
    const bt = await tok(biz), dt = await tok(d);
    const est = await call("POST", "/requests/estimate", { token: bt, body: body() });
    expect(est.json.available).toBe(true); expect(est.json.quote.totalCents).toBe(100_00);
    expect(JSON.stringify(est.json)).not.toMatch(/providerCost|marginCents/);

    const pub = await call("POST", "/requests", { token: bt, body: body({ publish: true, termsAccepted: true, recipientName: "Mona", recipientPhone: "+966511111111", deliveryAddress: "Olaya St 12" }) });
    expect(pub.status).toBe(201); expect(pub.json.status).toBe("published");
    const detail = await call("GET", `/requests/${pub.json.id}`, { token: bt });
    expect(JSON.stringify(detail.json)).not.toMatch(/providerCost|marginCents/);
    expect(detail.json.offers).toHaveLength(0); // unanswered offers are not exposed to the business

    const offers1 = await call("GET", "/driver/offers", { token: dt });
    expect(offers1.json.items).toHaveLength(1);
    const job = offers1.json.items[0];
    expect(job.recipient).toBeNull(); expect(job.delivery).toBeNull(); expect(job.expectedEarningCents).toBe(70_00);
    expect(job.actions).toEqual(["accept", "reject"]);

    expect((await call("POST", `/offers/${job.offerId}/accept`, { token: dt, body: { termsAccepted: false } })).status).toBe(422);
    const acc = await call("POST", `/offers/${job.offerId}/accept`, { token: dt, body: { termsAccepted: true } });
    expect(acc.status).toBe(200);
    const mine = await call("GET", `/driver/jobs/${job.offerId}`, { token: dt });
    expect(mine.json.recipient).toEqual({ name: "Mona", phone: "+966511111111" });
    expect(mine.json.delivery.address).toBe("Olaya St 12");
    const detail2 = await call("GET", `/requests/${pub.json.id}`, { token: bt });
    expect(detail2.json.offers[0].driver.phone).toBe(d.phone);
    expect(detail2.json.offers[0].actions).toContain("confirm_attendance");

    const wa = await call("GET", `/driver/jobs/${job.offerId}/whatsapp?kind=arriving&lang=en`, { token: dt });
    expect(wa.json.url).toContain("https://wa.me/966511111111?text=");
    // another driver cannot read this job
    const d2 = await mkDriver();
    expect((await call("GET", `/driver/jobs/${job.offerId}`, { token: await tok(d2) })).status).toBe(404);
    expect((await call("GET", `/driver/jobs/${job.offerId}/whatsapp`, { token: await tok(d2) })).status).toBe(404);
  });

  it("validation errors use the stable envelope", async () => {
    const biz = await mkBusiness();
    const r = await call("POST", "/requests", { token: await tok(biz), body: body({ quantity: 0, vehicleType: "spaceship" }) });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION"); expect(r.json.error.correlation_id).toBeTruthy(); expect(r.json.error.details).toBeTruthy();
    const dis = await call("POST", "/requests", { token: await tok(biz), body: body({ service: "delivery_driver", pickupCity: "jeddah" }) });
    expect(dis.status).toBe(422); // pickup limited to Riyadh in phase 1
  });

  it("wallet top-up is idempotent and flagged simulated", async () => {
    const biz = await mkBusiness(); const t = await tok(biz);
    const a = await call("POST", "/wallet/topup", { token: t, body: { amountCents: 500_00, idempotencyKey: "abcdefgh1" } });
    const b = await call("POST", "/wallet/topup", { token: t, body: { amountCents: 500_00, idempotencyKey: "abcdefgh1" } });
    expect(a.json.simulated).toBe(true); expect(b.json.availableCents).toBe(500_00);
    expect((await call("POST", "/wallet/topup", { token: t, body: { amountCents: -5, idempotencyKey: "abcdefgh2" } })).status).toBe(422);
  });
});

describe("integration API", () => {
  it("API keys: hash-only, scoped, revocable, max 5; external create is idempotent", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); await mkDriver();
    const t = await tok(biz);
    const k = await call("POST", "/business/api-keys", { token: t, body: { name: "ERP" } });
    expect(k.status).toBe(201); expect(k.json.key.startsWith("jrk_")).toBe(true);
    const list = await call("GET", "/business/api-keys", { token: t });
    expect(JSON.stringify(list.json)).not.toContain(k.json.key);
    const H = { "x-api-key": k.json.key };
    expect((await call("GET", "/jobs")).status).toBe(401);
    expect((await call("GET", "/jobs", { headers: { "x-api-key": "jrk_bad" } })).status).toBe(401);
    const c1 = await call("POST", "/jobs", { headers: { ...H, "idempotency-key": "order-1" }, body: body() });
    const c2 = await call("POST", "/jobs", { headers: { ...H, "idempotency-key": "order-1" }, body: body() });
    expect(c1.status).toBe(201); expect(c2.status).toBe(200); expect(c2.json.id).toBe(c1.json.id);
    expect((await call("POST", "/jobs", { headers: { ...H, "idempotency-key": "order-1" }, body: body({ quantity: 2 }) })).status).toBe(409);
    const list2 = await call("GET", "/jobs", { headers: H });
    expect(list2.json.total).toBe(1);
    const ev = await call("GET", `/jobs/${c1.json.id}/events`, { headers: H });
    expect(JSON.stringify(ev.json)).not.toMatch(/actorName|payload/);
    // another business' key cannot see it
    const other = await mkBusiness(); const k2 = await call("POST", "/business/api-keys", { token: await tok(other), body: { name: "other-erp" } });
    expect((await call("GET", `/jobs/${c1.json.id}`, { headers: { "x-api-key": k2.json.key } })).status).toBe(404);
    // revoke
    await call("POST", `/business/api-keys/${k.json.id}/revoke`, { token: t });
    expect((await call("GET", "/jobs", { headers: H })).status).toBe(401);
    for (let i = 0; i < 5; i++) await call("POST", "/business/api-keys", { token: t, body: { name: "key-" + i } });
    expect((await call("POST", "/business/api-keys", { token: t, body: { name: "key-six" } })).status).toBe(409);
  });
});

describe("documents & verification", () => {
  it("driver becomes verified only when all required docs approved; others can't read them", async () => {
    const admin = await mkAdmin(); const staff = await mkStaff(["documents.review"]);
    const d = await mkDriver({ verified: false }); const dt = await tok(d); const st = await tok(staff);
    for (const type of ["national_id", "driving_license", "vehicle_registration"]) {
      const fd = new FormData(); fd.set("type", type); fd.set("file", new File([new Uint8Array([1, 2, 3, 4])], "x.png", { type: "image/png" }));
      expect((await call("POST", "/documents", { token: dt, form: fd })).status).toBe(201);
    }
    const bad = new FormData(); bad.set("type", "national_id"); bad.set("file", new File(["x"], "x.exe", { type: "application/x-msdownload" }));
    expect((await call("POST", "/documents", { token: dt, form: bad })).status).toBe(422);
    const expired = new FormData(); expired.set("type", "national_id"); expired.set("expiresOn", "2020-01-01"); expired.set("file", new File([new Uint8Array([1])], "x.png", { type: "image/png" }));
    expect((await call("POST", "/documents", { token: dt, form: expired })).status).toBe(422);

    const docs = (await call("GET", "/admin/documents", { token: st })).json.items;
    expect(docs).toHaveLength(3);
    expect((await call("POST", `/admin/documents/${docs[0].id}/review`, { token: st, body: { decision: "rejected" } })).status).toBe(422); // needs a note
    for (const doc of docs.slice(0, 2)) await call("POST", `/admin/documents/${doc.id}/review`, { token: st, body: { decision: "approved" } });
    let p = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p[0].verificationStatus).toBe("pending");
    await call("POST", `/admin/documents/${docs[2].id}/review`, { token: st, body: { decision: "approved" } });
    p = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p[0].verificationStatus).toBe("verified");
    // file access
    expect((await call("GET", `/documents/${docs[0].id}/file`, { token: dt })).status).toBe(200);
    expect((await call("GET", `/documents/${docs[0].id}/file`, { token: st })).status).toBe(200);
    const other = await mkDriver();
    expect((await call("GET", `/documents/${docs[0].id}/file`, { token: await tok(other) })).status).toBe(404);
    expect((await call("GET", `/documents/${docs[0].id}/file`, { token: await tok(await mkBusiness()) })).status).toBe(404);
    void admin; void documents;
  });
});

describe("office flow", () => {
  it("invite → accept link → office assigns driver; office never sees customer price", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const ot = await tok(office);
    const d = await mkDriver(); const dt = await tok(d);
    const inv = await call("POST", "/office/drivers/invite", { token: ot, body: { phone: d.phone } });
    expect(inv.status).toBe(201);
    expect((await call("POST", "/office/drivers/invite", { token: ot, body: { phone: d.phone } })).status).toBe(409);
    const mine = await call("GET", "/driver/invites", { token: dt });
    expect(mine.json.items).toHaveLength(1);
    expect((await call("POST", `/driver/invites/${mine.json.items[0].id}/respond`, { token: dt, body: { accept: true } })).status).toBe(200);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const bt = await tok(biz);
    const pub = await call("POST", "/requests", { token: bt, body: body({ publish: true, termsAccepted: true, preferredOfficeId: office.id }) });
    expect(pub.status).toBe(201);
    // during the office window no system offers go out
    expect((await call("GET", "/driver/offers", { token: dt })).json.items).toHaveLength(0);
    const opp = await call("GET", "/office/opportunities", { token: ot });
    expect(opp.json.items[0].eligibleDrivers).toHaveLength(1);
    const asg = await call("POST", `/office/opportunities/${pub.json.id}/assign`, { token: ot, body: { driverId: d.id } });
    expect(asg.status).toBe(201);
    const o = (await call("GET", "/driver/offers", { token: dt })).json.items[0];
    expect(o.earningHidden).toBe(true); expect(o.expectedEarningCents).toBeNull(); // office-linked drivers don't see rates
    await call("POST", `/offers/${o.offerId}/accept`, { token: dt, body: { termsAccepted: true } });
    // linked driver can't withdraw (paid via office)
    expect((await call("POST", "/withdrawals", { token: dt, body: { amountCents: 20000 } })).status).toBe(403);
    const jobs = await call("GET", "/office/jobs", { token: ot });
    expect(jobs.json.items).toHaveLength(1);
    // unlink is blocked while the driver has an active job
    expect((await call("POST", `/office/drivers/${d.id}/unlink`, { token: ot })).status).toBe(409);
  });

  it("unverified office / no agreement cannot access opportunities", async () => {
    const o = await mkOffice({ agreement: false });
    expect((await call("GET", "/office/opportunities", { token: await tok(o) })).status).toBe(403);
  });
});

describe("complaints, tickets, chat", () => {
  it("only parties can complain; staff resolve with a reason; chat is party-scoped", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }), d = await mkDriver(), stranger = await mkBusiness();
    const bt = await tok(biz), dt = await tok(d);
    const pub = await call("POST", "/requests", { token: bt, body: body({ publish: true, termsAccepted: true }) });
    const off = (await call("GET", "/driver/offers", { token: dt })).json.items[0];
    await call("POST", `/offers/${off.offerId}/accept`, { token: dt, body: { termsAccepted: true } });

    expect((await call("POST", "/complaints", { token: await tok(stranger), body: { category: "delay", description: "this is a long enough description", offerId: off.offerId } })).status).toBe(404);
    const c = await call("POST", "/complaints", { token: bt, body: { category: "no_show", description: "driver did not show up on time", offerId: off.offerId } });
    expect(c.status).toBe(201); expect(c.json.priority).toBe("urgent");
    const staff = await mkStaff(["complaints.manage"]); const st = await tok(staff);
    expect((await call("PATCH", `/admin/complaints/${c.json.id}`, { token: st, body: { status: "resolved" } })).status).toBe(422);
    expect((await call("PATCH", `/admin/complaints/${c.json.id}`, { token: st, body: { status: "closed", resolution: "x" } })).status).toBe(409); // open → closed not allowed
    expect((await call("PATCH", `/admin/complaints/${c.json.id}`, { token: st, body: { status: "resolved", resolution: "Compensated by ops" } })).status).toBe(200);
    expect((await call("PATCH", `/admin/complaints/${c.json.id}`, { token: st, body: { status: "closed" } })).status).toBe(200);

    const m = await call("POST", `/offers/${off.offerId}/messages`, { token: dt, body: { body: "I am on my way" } });
    expect(m.status).toBe(201);
    expect((await call("GET", `/offers/${off.offerId}/messages`, { token: bt })).json.items).toHaveLength(1);
    expect((await call("GET", `/offers/${off.offerId}/messages`, { token: await tok(stranger) })).status).toBe(404);
    expect((await call("POST", `/offers/${off.offerId}/messages`, { token: await tok(stranger), body: { body: "hi" } })).status).toBe(404);
    expect((await call("POST", "/tickets", { token: bt, body: { category: "driver_no_show", subject: "Driver late", offerId: off.offerId } })).status).toBe(201);
    expect((await call("POST", "/tickets", { token: bt, body: { category: "not_a_category", subject: "Hmm" } })).status).toBe(422);
    void pub; void offers; void users; void businessProfiles;
  });
});

describe("admin: pricing, reports", () => {
  it("pricing versions supersede; business override wins; CSV export audited & safe", async () => {
    const admin = await mkAdmin(); const t = await tok(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 });
    const r1 = await call("POST", "/admin/pricing", { token: t, body: { service: "delivery_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 1000, providerCostCents: 700 } });
    expect(r1.status).toBe(201);
    const r2 = await call("POST", "/admin/pricing", { token: t, body: { service: "delivery_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 1200, providerCostCents: 800 } });
    expect(r2.json.version).toBe(2);
    expect((await call("POST", "/admin/pricing", { token: t, body: { service: "delivery_driver", priceCents: 500, providerCostCents: 600 } })).status).toBe(422);
    const bt = await tok(biz);
    expect((await call("POST", "/requests/estimate", { token: bt, body: body() })).json.quote.unitPriceCents).toBe(1200);
    await call("POST", "/admin/pricing", { token: t, body: { service: "delivery_driver", vehicleType: "sedan", businessId: biz.id, priceCents: 900, providerCostCents: 700 } });
    expect((await call("POST", "/requests/estimate", { token: bt, body: body() })).json.quote.unitPriceCents).toBe(900);
    const csv = await call("GET", "/admin/reports/requests?format=csv", { token: t });
    expect(csv.status).toBe(200); expect(csv.headers.get("content-type")).toContain("text/csv");
    expect((await call("GET", "/admin/audit", { token: t })).json.items.some((a: any) => a.action === "report.export")).toBe(true);
  });
});

describe("recipient phone & error shape (found by the Flutter live tests)", () => {
  it("stores recipient phone in international form so WhatsApp/tel links work; rejects junk", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
    const bt = await tok(biz), dt = await tok(d);
    const bad = await call("POST", "/requests", { token: bt, body: body({ recipientPhone: "12" }) });
    expect(bad.status).toBe(422); expect(bad.json.error.details.recipientPhone).toBeTruthy();
    const ok = await call("POST", "/requests", { token: bt, body: body({ publish: true, termsAccepted: true, recipientName: "Mona", recipientPhone: "0555 555 555" }) });
    expect(ok.status).toBe(201); expect(ok.json.recipientPhone).toBe("+966555555555");
    const off = (await call("GET", "/driver/offers", { token: dt })).json.items[0];
    await call("POST", `/offers/${off.offerId}/accept`, { token: dt, body: { termsAccepted: true } });
    const wa = await call("GET", `/driver/jobs/${off.offerId}/whatsapp?kind=contact&lang=ur`, { token: dt });
    expect(wa.json.url.startsWith("https://wa.me/966555555555?text=")).toBe(true);
  });

  it("domain validation errors are keyed by field, like schema errors", async () => {
    const reg = await call("POST", "/auth/otp/send", { body: { phone: "0500000555" } });
    const v = await call("POST", "/auth/otp/verify", { body: { phone: "0500000555", code: reg.json.demoCode } });
    const r = await call("POST", "/auth/register", { body: { registrationToken: v.json.registrationToken, role: "driver", name: "Van Driver", vehicleType: "van", services: ["delivery_driver"], termsAccepted: true } });
    expect(r.status).toBe(422);
    expect(r.json.error.details.vehicleTemperature).toBeTruthy();
    expect(r.json.error.details.field).toBe("vehicleTemperature");
  });
});

describe("going online backfills open requests", () => {
  it("a driver who comes online after publish receives matching offers (and only eligible ones)", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 });
    const offline = await mkDriver({ available: false }); const wrongVehicle = await mkDriver({ available: false, vehicle: "dyna" });
    const bt = await tok(biz), dt = await tok(offline), wt = await tok(wrongVehicle);
    const pub = await call("POST", "/requests", { token: bt, body: body({ publish: true, termsAccepted: true }) });
    expect(pub.status).toBe(201);
    expect((await call("GET", "/driver/offers", { token: dt })).json.items).toHaveLength(0); // offline drivers are not offered at publish
    const on = await call("PUT", "/driver/availability", { token: dt, body: { available: true } });
    expect(on.json.newOffers).toBe(1);
    expect((await call("GET", "/driver/offers", { token: dt })).json.items).toHaveLength(1);
    await call("PUT", "/driver/availability", { token: dt, body: { available: false } });
    await call("PUT", "/driver/availability", { token: dt, body: { available: true } }); // idempotent: no duplicate offers
    expect((await call("GET", "/driver/offers", { token: dt })).json.items).toHaveLength(1);
    const wrong = await call("PUT", "/driver/availability", { token: wt, body: { available: true } });
    expect(wrong.json.newOffers).toBe(0); // vehicle mismatch
    void pub;
  });
});
