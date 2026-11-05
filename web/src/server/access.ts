import { eq } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { offers, requests, type Offer, type Request, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can } from "./auth/permissions";

export type JobAccess = { offer: Offer; request: Request; side: "business" | "driver" | "office" | "staff" };

/** Resolves a user's relationship to a job; throws NOT_FOUND (never reveals existence) when none. */
export async function jobAccess(user: User, offerId: string, x: Exec = db): Promise<JobAccess> {
  const [row] = await x.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(eq(offers.id, offerId));
  if (!row) throw err("NOT_FOUND");
  const { o, r } = row;
  if (user.id === r.businessId) return { offer: o, request: r, side: "business" };
  if (user.id === o.driverId) return { offer: o, request: r, side: "driver" };
  if (user.role === "office" && o.officeId === user.id) return { offer: o, request: r, side: "office" };
  if (can(user, "requests.view")) return { offer: o, request: r, side: "staff" };
  throw err("NOT_FOUND");
}

export async function requestAccess(user: User, requestId: string, x: Exec = db): Promise<{ request: Request; side: "business" | "staff" | "driver" | "office" }> {
  const [r] = await x.select().from(requests).where(eq(requests.id, requestId));
  if (!r) throw err("NOT_FOUND");
  if (user.id === r.businessId) return { request: r, side: "business" };
  if (can(user, "requests.view")) return { request: r, side: "staff" };
  const [o] = await x.select().from(offers).where(eq(offers.requestId, requestId));
  void o;
  throw err("NOT_FOUND");
}
