import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, complaints } from "@/db/schema";
import { mkAdmin, mkBusiness, mkRule } from "./factories";
import { moneyViolations } from "./invariants";
import { expect } from "vitest";

/** Shared by the A2 money tests (audit K): one company with funds and an approved rule, the offer of a driver on a request, the books check, a settlement hold. */
export const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
export async function setup(funds = 5000_00) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds }); return { admin, biz }; }
export const sound = async () => expect(await moneyViolations()).toEqual([]);
export const hold = async (biz: { id: string }, requestId: string, offerId: string, n: number) =>
  (await db.insert(complaints).values({ ref: `CP-A2-${n}`, filedBy: biz.id, filedByRole: "business", requestId, offerId, category: "other", description: "hold the payment please", holdsSettlement: true, status: "open" }).returning())[0];
export const release = (id: string) => db.update(complaints).set({ status: "resolved", holdsSettlement: false }).where(eq(complaints.id, id));
