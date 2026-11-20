import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { apiLogin, DEMO } from "./helpers";

/**
 * Platform update J — J4 (a driver of an office sees no earnings and no wallet, only that his office manages it, and his cash) and
 * J5 (every order card on the driver's pages shows its stat cards, from the offer to the history). Tariq belongs to Al Wajiha Courier Office;
 * Omar is a direct driver. The warehouse and the driver's field steps are driven through the API (the endpoints the apps call).
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const WAREHOUSE = { lat: 24.7136, lng: 46.6753 };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const ready = async (page: Page, url: string) => { await page.goto(url); await page.waitForSelector('html[data-hydrated="true"]'); };
const val = (page: Page, id: string) => page.getByTestId(id).first();

test("an office driver: wallet card + cash, no earnings anywhere; every order card has its stat cards", async ({ browser }) => {
  test.setTimeout(240_000);
  const biz = await apiLogin(browser, DEMO.business);
  const od = await apiLogin(browser, "0500000016"); // Tariq — sedan, linked to Al Wajiha Courier Office
  await api(od.request, "PUT", "/driver/availability", { available: true });
  const base = (await api(od.request, "GET", "/driver/cash")).json as { collectedCents: number; receivedCents: number; outstandingCents: number };

  // ── the account: no wallet, no earnings; cash untouched ──
  const ov = (await api(od.request, "GET", "/driver/overview")).json;
  expect(ov).toMatchObject({ wallet: null, walletManagedByOffice: true, officeName: "Al Wajiha Courier Office" });
  expect((await api(od.request, "GET", "/wallet")).json).toMatchObject({ managedByOffice: true, availableCents: null, entries: [], total: 0 });
  const wd = await api(od.request, "POST", "/withdrawals", { amountCents: 20_000 });
  expect(wd.status).toBe(403); expect(wd.json.error.code).toBe("WALLET_MANAGED_BY_OFFICE");

  // ── an order of 3 parcels, one cash on delivery (150.00), offered to the sedan drivers ──
  const shipments = [{ n: 1, cod: 15_000 }, { n: 2, cod: 0 }, { n: 3, cod: 0 }].map(({ n, cod }) => ({ recipientName: `Office Cash Customer ${n}`, recipientPhone: `05500000${String(n + 20)}`, address: `${n} Olaya St, Riyadh`, externalRef: `OFC-E2E-${n}`, contents: "Parcel", codCents: cod }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3600_000).toISOString(), shipments, publish: true, termsAccepted: true });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  const page = await od.newPage();
  const offer = (await api(od.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer).toBeTruthy();
  expect(offer.earningHidden).toBe(true); expect(offer.expectedEarningCents).toBeNull();

  // J5 — the offered card (dashboard): expected parcels, everything still to deliver
  await ready(page, "/driver");
  const offered = page.getByTestId("job-card-stats").first();
  await expect(offered).toBeVisible();
  await expect(val(page, "card-stat-total")).toHaveAttribute("data-value", "3");
  await expect(val(page, "card-stat-to-deliver")).toHaveAttribute("data-value", "3");
  await expect(val(page, "card-stat-delivered")).toHaveAttribute("data-value", "0");
  await expect(offered).toHaveAttribute("data-estimated", "true");
  await expect(page.getByText(/expected earning/i)).toHaveCount(0);

  // ── accept → check-in → the warehouse confirms → the driver scans the parcels ──
  expect((await api(od.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  expect((await api(od.request, "POST", `/offers/${offer.offerId}/checkin`, WAREHOUSE)).status).toBe(200);
  expect((await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true })).status).toBe(200);
  const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; codCents: number; demoOtp: string }>;
  expect(list).toHaveLength(3);

  // J5 — accepted, not loaded: the parcels are assigned and all still to deliver, with the cash to collect
  await ready(page, "/driver/jobs");
  const active = page.getByTestId("job-card-stats").first();
  await expect(active).toBeVisible();
  await expect(val(page, "card-stat-total")).toHaveAttribute("data-value", "3");
  await expect(val(page, "card-stat-to-deliver")).toHaveAttribute("data-value", "3");
  await expect(val(page, "card-stat-delivered")).toHaveAttribute("data-value", "0");
  await expect(val(page, "card-stat-cod")).toHaveAttribute("data-value", "15000");
  await expect(active).toHaveAttribute("data-estimated", "false");

  for (const s of list) expect((await api(od.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: s.code })).status).toBe(200);
  expect((await api(od.request, "POST", `/offers/${offer.offerId}/loading/finish`, {})).status).toBe(200);
  await api(od.request, "POST", `/offers/${offer.offerId}/route/approve`); // not needed (and refused) when routing is off
  const stops = (await api(od.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops as Array<{ id: string }>;
  const ordered = stops.map((s) => list.find((x) => x.id === s.id)!);
  const deliver = async (s: (typeof list)[number]) => {
    expect((await api(od.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/arrive`, {})).status).toBe(200);
    expect((await api(od.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/deliver`, { code: s.code, otp: s.demoOtp, ...(s.codCents > 0 ? { cashCollectedCents: s.codCents } : {}) })).status).toBe(200);
  };
  await deliver(ordered[0]);
  await ready(page, "/driver/jobs");
  await expect(val(page, "card-stat-delivered")).toHaveAttribute("data-value", "1");
  await expect(val(page, "card-stat-to-deliver")).toHaveAttribute("data-value", "2");
  for (const s of ordered.slice(1)) await deliver(s);
  expect((await api(od.request, "POST", `/offers/${offer.offerId}/delivered`, {})).json.status).toBe("completed");

  // ── the job screen: completed, without a wallet link or earnings ──
  await ready(page, `/driver/jobs/${offer.offerId}`);
  await expect(page.getByTestId("job-completed")).toBeVisible();
  await expect(page.getByTestId("job-completed-wallet")).toHaveCount(0);
  await expect(page.getByTestId("job-completed")).not.toContainText(/earning/i);

  // ── J5 — the history card shows the final result and the cash: collected now, handed over after the warehouse records it ──
  await ready(page, "/driver/jobs?scope=history");
  const card = page.locator("a", { has: page.getByText(pub.json.ref) }).first();
  await expect(card).toBeVisible();
  await expect(card.getByTestId("card-stat-total")).toHaveAttribute("data-value", "3");
  await expect(card.getByTestId("card-stat-delivered")).toHaveAttribute("data-value", "3");
  await expect(card.getByTestId("card-stat-not-delivered")).toHaveAttribute("data-value", "0");
  await expect(card.getByTestId("card-stat-to-deliver")).toHaveAttribute("data-value", "0");
  await expect(card.getByTestId("card-stat-cod-collected")).toHaveAttribute("data-value", "15000");
  await expect(card.getByTestId("card-stat-cod-handed")).toHaveAttribute("data-value", "0");
  await expect(card).not.toContainText(/earning/i);
  expect((await api(biz.request, "POST", "/business/cod/receive", { offerId: offer.offerId, amountCents: 5_000 })).status).toBe(201);
  await ready(page, "/driver/jobs?scope=history");
  await expect(page.locator("a", { has: page.getByText(pub.json.ref) }).first().getByTestId("card-stat-cod-handed")).toHaveAttribute("data-value", "5000");

  // ── the wallet page: ONE calm card (office name, "ask your office") + the cash section as on the cash page ──
  await ready(page, "/driver/wallet");
  await expect(page.getByTestId("wallet-managed-card")).toBeVisible();
  await expect(page.getByTestId("wallet-managed-card")).toContainText("managed by your office");
  await expect(page.getByTestId("wallet-managed-office")).toHaveText("Al Wajiha Courier Office");
  await expect(page.getByTestId("wallet-managed-card")).toContainText(/ask your office/i);
  await expect(page.getByTestId("cash-total-collected")).toHaveAttribute("data-value", String(base.collectedCents + 15_000));
  await expect(page.getByTestId("cash-total-received")).toHaveAttribute("data-value", String(base.receivedCents + 5_000));
  await expect(page.getByTestId("cash-total-outstanding")).toHaveAttribute("data-value", String(base.outstandingCents + 10_000));
  for (const id of ["wallet-withdraw", "wallet-entry", "wallet-export", "wallet-auto-note", "wallet-topup"]) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText(/available balance|request withdrawal|on hold/i)).toHaveCount(0);
  // the sidebar says "Wallet & cash" and the top bar has no balance chip
  await expect(page.getByRole("link", { name: "Wallet & cash" }).first()).toHaveAttribute("href", "/driver/wallet");
  await expect(page.getByRole("link", { name: /^Earnings/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Wallet & cash: / })).toHaveCount(0);
  // …and the link to the cash details works
  await page.getByTestId("wallet-cash-link").click();
  await expect(page).toHaveURL(/\/driver\/cash$/);
  await expect(page.getByTestId("cash-total-outstanding")).toHaveAttribute("data-value", String(base.outstandingCents + 10_000));

  // ── the dashboard: his cash, the office instead of a balance, no earnings figures ──
  await ready(page, "/driver");
  await expect(page.getByTestId("cash-card")).toHaveAttribute("data-value", String(base.outstandingCents + 10_000));
  await expect(page.getByTestId("wallet-managed-card")).toContainText("Managed by your office");
  await expect(page.getByTestId("wallet-on-hold")).toHaveCount(0);
  await expect(page.getByText(/available balance|expected earning/i)).toHaveCount(0);

  // ── the profile says who manages the wallet ──
  await ready(page, "/driver/profile");
  await expect(page.getByTestId("profile-office-note")).toContainText("Al Wajiha Courier Office");

  // ── notifications: no wallet or earning notifications ──
  const types = ((await api(od.request, "GET", "/notifications")).json.items as Array<{ type: string; data: Record<string, unknown> | null }>);
  expect(types.some((n) => ["payout_paid", "withdrawal_paid", "withdrawal_rejected", "wallet_adjusted"].includes(n.type))).toBe(false);
  expect(types.every((n) => !n.data || !("earningCents" in n.data))).toBe(true);
});

test("a direct driver keeps his wallet: earnings page, balance, withdrawals", async ({ browser }) => {
  const dd = await apiLogin(browser, DEMO.driver); // Omar — sedan, no office
  const ov = (await api(dd.request, "GET", "/driver/overview")).json;
  expect(ov.walletManagedByOffice).toBe(false); expect(ov.wallet).toMatchObject({ availableCents: expect.any(Number) });
  expect((await api(dd.request, "GET", "/wallet")).json).toMatchObject({ managedByOffice: false, availableCents: expect.any(Number) });
  const page = await dd.newPage();
  await ready(page, "/driver/wallet");
  await expect(page.getByTestId("wallet-auto-note")).toBeVisible();
  await expect(page.getByTestId("wallet-managed-card")).toHaveCount(0);
  await expect(page.getByText("Available balance").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Earnings$/ }).first()).toBeVisible();
  await ready(page, "/driver");
  await expect(page.getByTestId("wallet-managed-card")).toHaveCount(0);
  await expect(page.getByText("Available balance").first()).toBeVisible();
});
