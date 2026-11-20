import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { partnerConnections, partnerOrders, type PartnerConnection } from "@/db/schema";
import { ctxOf, settingsOf } from "./config";
import { LIVE_PARCEL_SQL } from "./orders-core";
import { applyInbound, importOrder } from "./inbound";
import { recordEvent, setHealth } from "./outbox";
import { getAdapter } from "./registry";
import { PartnerError } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);
const TRACK_PER_RUN = 50;
const running = new Set<string>();

/**
 * Scheduled pull (decision I13), for partners whose webhooks are missing (Fizzpa), unreliable (LogesTech does not retry) or optional
 * (Shipox): new orders → Incoming orders, and the current partner status of every order JR is still working on. One connection is
 * claimed by one instance at a time (compare-and-set on last_poll_at, also for "Check now"); each run is bounded and rotates fairly
 * through the open orders (last_tracked_at), so order 51 is checked as surely as order 1.
 */
export async function pollPartners(now = new Date(), opts: { connectionId?: string; force?: boolean } = {}) {
  const conns = await db.select().from(partnerConnections).where(and(eq(partnerConnections.status, "active"), opts.connectionId ? eq(partnerConnections.id, opts.connectionId) : undefined));
  const out: Array<{ id: string; imported: number; tracked: number; changed: number; error?: string; busy?: boolean }> = [];
  for (const c of conns) {
    const a = getAdapter(c.provider);
    if (!a || (!a.pollOrders && !a.track)) continue;
    const s = settingsOf(c, a);
    if (!opts.force && s.pollMinutes <= 0) continue;
    // Never two runs of one connection in this process; across instances the scheduled runs claim by compare-and-set, and a
    // "Check now" (force) runs at once (its writes are idempotent).
    if (running.has(c.id)) { if (opts.force) out.push({ id: c.id, imported: 0, tracked: 0, changed: 0, busy: true }); continue; }
    const dueBefore = opts.force ? now : new Date(now.getTime() - s.pollMinutes * 60_000);
    const claim = await db.update(partnerConnections).set({ lastPollAt: now })
      .where(and(eq(partnerConnections.id, c.id), or(isNull(partnerConnections.lastPollAt), lte(partnerConnections.lastPollAt, dueBefore)))).returning({ id: partnerConnections.id });
    if (!claim.length) continue;
    running.add(c.id);
    try { out.push(await pollOne(c, now)); } finally { running.delete(c.id); }
  }
  return { connections: out.length, results: out };
}

async function pollOne(c: PartnerConnection, now: Date) {
  const a = getAdapter(c.provider)!;
  const ctx = ctxOf(c);
  const s = settingsOf(c, a);
  let imported = 0, tracked = 0, changed = 0, failures = 0, lastError: string | null = null;
  try {
    if (a.pollOrders && s.importNew) {
      const since = typeof ctx.meta.lastOrderPollAt === "string" ? new Date(ctx.meta.lastOrderPollAt) : null;
      const r = await a.pollOrders(ctx, since);
      for (const o of r.orders) {
        try { const x = await importOrder(c, a, o, "poll"); if (x.created) imported++; }
        catch (e) { failures++; lastError = msg(e); }
      }
      // Only a complete read moves the cursor: anything not read yet is read again next time (imports are idempotent).
      if (r.complete && !failures) await ctx.saveMeta({ lastOrderPollAt: now.toISOString() });
      else if (!r.complete) await recordEvent(c, { direction: "poll", kind: "poll", outcome: "ignored", summary: `More than ${r.orders.length} new orders — the rest is read on the next run` });
    }
    if (a.track) {
      // Orders JR has not finished with (open in Incoming orders, or on a live parcel not delivered / returned yet), least recently checked first.
      const rows = (await db.execute(sql`
        select po.id, po.external_id, po.external_ref, po.invoice, po.partner_status from partner_orders po ${LIVE_PARCEL_SQL}
        where po.connection_id = ${c.id} and po.state <> 'cancelled' and po.updated_at > now() - interval '30 days'
          and (cur.s_id is null or cur.s_status in ('pending', 'loaded', 'failed'))
        order by po.last_tracked_at asc nulls first, po.created_at asc limit ${TRACK_PER_RUN}`)).rows as Array<{ id: string; external_id: string | null; external_ref: string; invoice: string | null; partner_status: string | null }>;
      if (rows.length) await db.update(partnerOrders).set({ lastTrackedAt: now }).where(inArray(partnerOrders.id, rows.map((r) => r.id)));
      for (const r of rows) {
        try {
          const ev = await a.track(ctx, { externalId: r.external_id, externalRef: r.external_ref, invoice: r.invoice });
          tracked++;
          if (!ev) continue;
          if (ev.status !== r.partner_status) changed++;
          await applyInbound(c, a, ev);
        } catch (e) {
          // One order the partner refuses (another customer's, deleted …) must not stop the others; a rejected key does.
          if (e instanceof PartnerError && e.kind === "auth") throw e;
          failures++; lastError = msg(e);
        }
      }
    }
    if (imported || changed || failures) await recordEvent(c, { direction: "poll", kind: "poll", outcome: failures ? "error" : "ok", summary: `Scheduled check: ${imported} new order(s), ${tracked} checked, ${changed} changed${failures ? `, ${failures} failed (${lastError})` : ""}` });
    await setHealth(c.id, !failures || tracked + imported > 0, failures ? lastError : null);
    return { id: c.id, imported, tracked, changed, ...(failures ? { error: "partial" } : {}) };
  } catch (e) {
    await setHealth(c.id, false, msg(e));
    await recordEvent(c, { direction: "poll", kind: "poll", outcome: "error", summary: msg(e) });
    return { id: c.id, imported, tracked, changed, error: e instanceof PartnerError ? e.kind : "unavailable" };
  }
}
