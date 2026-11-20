import { eq } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { driverProfiles, officeProfiles, users, type User } from "@/db/schema";

/**
 * J4 — a driver who belongs to a courier office (`driver_profiles.office_id is not null`) does not see what he earns: the office is paid and manages
 * the money. He still sees the cash on delivery he holds. Everything here is DERIVED from the profile at read time, never stored, so a driver who leaves
 * the office gets his wallet back with nothing to migrate. Staff and office views never call this.
 */
export interface WalletPolicy { managedByOffice: boolean; officeId: string | null; officeName: string | null }

/** Pure: the policy for a driver profile row (`officeId` null / undefined = a direct driver). */
export function policyOf(officeId: string | null | undefined, officeName?: string | null): WalletPolicy {
  return officeId ? { managedByOffice: true, officeId, officeName: officeName ?? null } : { managedByOffice: false, officeId: null, officeName: null };
}

/** Who manages this user's wallet. Users without a driver profile (business, office, staff) are never "managed by an office". */
export async function walletPolicy(userId: string, x: Exec = db): Promise<WalletPolicy> {
  const [p] = await x.select({ officeId: driverProfiles.officeId, office: officeProfiles.officeName, name: users.name }).from(driverProfiles)
    .leftJoin(officeProfiles, eq(officeProfiles.userId, driverProfiles.officeId)).leftJoin(users, eq(users.id, driverProfiles.officeId))
    .where(eq(driverProfiles.userId, userId));
  return policyOf(p?.officeId, p?.office ?? p?.name);
}

/** `GET /wallet` for an office driver: no balances, no entries (the page shows who manages the wallet instead). */
export const managedWalletPayload = (p: WalletPolicy) => ({
  managedByOffice: true as const, officeName: p.officeName,
  availableCents: null, reservedCents: null, heldCents: null, entries: [] as never[], total: 0, page: 1, pageSize: 25,
});

/** What an office driver's `GET /driver/overview` says about money: no wallet block, no pending amount (his cash figure is separate and unchanged). */
export const overviewWalletFields = (p: WalletPolicy, wallet: { availableCents: number; heldCents: number; pendingCents: number } | null) => (
  p.managedByOffice ? { wallet: null, walletManagedByOffice: true, officeName: p.officeName } : { wallet, walletManagedByOffice: false, officeName: null }
);

/** Notification types that only carry wallet money (a payout, a withdrawal result, a manual wallet adjustment): not shown to an office driver. */
export const WALLET_NOTIFICATION_TYPES = ["payout_paid", "withdrawal_paid", "withdrawal_rejected", "wallet_adjusted"] as const;
/** Earning keys a notification's `data` may carry (offer notifications include the expected earning for direct drivers). Cash keys (`cod_received`) stay: cash is visible. */
const MONEY_KEYS = ["earningCents", "expectedEarningCents", "providerCents"];

/** Pure: drops the money keys of a notification payload. */
export function scrubMoney<T extends Record<string, unknown> | null | undefined>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!MONEY_KEYS.includes(k)) out[k] = v;
  return out as T;
}

/** `GET /notifications`: unchanged for everyone except an office driver, who gets neither the wallet notifications nor money figures in the rest. */
export async function listMyNotifications(user: User, unreadOnly: boolean, page: number) {
  const managed = user.role === "driver" && (await walletPolicy(user.id)).managedByOffice;
  const { listNotifications } = await import("./support"); // lazy: keeps this file light for the pure helpers' unit tests
  const res = await listNotifications(user, unreadOnly, page, 30, managed ? [...WALLET_NOTIFICATION_TYPES] : undefined);
  return managed ? { ...res, items: res.items.map((n) => ({ ...n, data: scrubMoney(n.data as Record<string, unknown> | null) })) } : res;
}

/** Pure: an office driver's job timeline has no "payout paid" milestone (the payout goes to the office). */
export const timelineFor = <T extends { type: string }>(items: T[], managed: boolean): T[] => (managed ? items.filter((e) => e.type !== "payout_paid") : items);
