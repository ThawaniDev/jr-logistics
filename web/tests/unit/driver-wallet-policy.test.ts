import { describe, it, expect } from "vitest";
import { policyOf, managedWalletPayload, overviewWalletFields, scrubMoney, timelineFor, WALLET_NOTIFICATION_TYPES } from "@/server/driver-wallet-policy";
import { relabelWalletNav } from "@/components/features/driver-nav-labels";
import { NAV } from "@/components/layout/nav";
import en from "@/i18n/en";
import { extra } from "@/i18n/fragments";

describe("J4 — wallet policy of a driver", () => {
  it("a driver with an office is managed by it; a direct driver (or no profile) is not", () => {
    expect(policyOf("office-1", "Al Wajiha")).toEqual({ managedByOffice: true, officeId: "office-1", officeName: "Al Wajiha" });
    expect(policyOf("office-1")).toEqual({ managedByOffice: true, officeId: "office-1", officeName: null });
    expect(policyOf(null, "ignored")).toEqual({ managedByOffice: false, officeId: null, officeName: null });
    expect(policyOf(undefined)).toEqual({ managedByOffice: false, officeId: null, officeName: null });
  });

  it("GET /wallet for an office driver has no balances and no entries (the shape the mobile app reads)", () => {
    const w = managedWalletPayload(policyOf("o", "Al Wajiha"));
    expect(w).toMatchObject({ managedByOffice: true, officeName: "Al Wajiha", availableCents: null, reservedCents: null, heldCents: null, entries: [], total: 0, page: 1, pageSize: 25 });
    expect(JSON.stringify(w)).not.toMatch(/\d{2,}Cents/);
  });

  it("GET /driver/overview: wallet is null for an office driver, intact for a direct one", () => {
    const wallet = { availableCents: 1200, heldCents: 300, pendingCents: 500 };
    expect(overviewWalletFields(policyOf("o", "Al Wajiha"), wallet)).toEqual({ wallet: null, walletManagedByOffice: true, officeName: "Al Wajiha" });
    expect(overviewWalletFields(policyOf(null), wallet)).toEqual({ wallet, walletManagedByOffice: false, officeName: null });
  });

  it("notification payloads lose the earning figures but keep cash and everything else", () => {
    expect(scrubMoney({ ref: "R1", parcels: 4, earningCents: 12_000, expectedEarningCents: 5, providerCents: 7, amountCents: 3000, amount: "30.00" })).toEqual({ ref: "R1", parcels: 4, amountCents: 3000, amount: "30.00" });
    expect(scrubMoney(null)).toBeNull();
    expect(scrubMoney(undefined)).toBeUndefined();
  });

  it("the wallet notification types are hidden; the job and cash ones are not", () => {
    expect([...WALLET_NOTIFICATION_TYPES]).toEqual(["payout_paid", "withdrawal_paid", "withdrawal_rejected", "wallet_adjusted"]);
    for (const keep of ["offer_new", "job_completed", "cod_received", "office_unlinked"]) expect((WALLET_NOTIFICATION_TYPES as readonly string[]).includes(keep)).toBe(false);
  });

  it("the job timeline of an office driver has no payout milestone", () => {
    const items = [{ type: "driver_assigned" }, { type: "payout_paid" }, { type: "request_completed" }];
    expect(timelineFor(items, true).map((e) => e.type)).toEqual(["driver_assigned", "request_completed"]);
    expect(timelineFor(items, false)).toHaveLength(3);
  });

  it("the sidebar entry of the wallet is renamed only for an office driver and keeps its href", () => {
    const groups = NAV.driver;
    expect(relabelWalletNav(groups, false)).toBe(groups);
    const items = relabelWalletNav(groups, true).flatMap((g) => g.items);
    const wallet = items.find((i) => i.href === "/driver/wallet");
    expect(wallet?.key).toBe("jd.nav_wallet_cash");
    expect(items.filter((i) => i.key === "nav.earnings")).toHaveLength(0);
    expect(items.some((i) => i.href === "/driver/cash")).toBe(true);
    expect(groups.flatMap((g) => g.items).find((i) => i.href === "/driver/wallet")?.key).toBe("nav.earnings"); // the definition itself is untouched
  });

  it("every new key exists in English, Arabic and Urdu with the same placeholders", () => {
    const keys = ["jd.nav_wallet_cash", "jd.managed_title", "jd.managed_body", "jd.managed_hint", "jd.cash_title", "jd.linked_note", "jd.dash_wallet_hint", "jd.stat_cod_handed", "err.WALLET_MANAGED_BY_OFFICE"];
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys) {
      const e = extra.en[k] ?? (en as Record<string, string>)[k];
      expect(e, k).toBeTruthy();
      for (const l of ["ar", "ur"] as const) { expect(extra[l][k], `${l}:${k}`).toBeTruthy(); expect(ph(extra[l][k]), `${l}:${k}`).toBe(ph(e)); }
    }
  });
});
