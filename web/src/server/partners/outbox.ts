import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { partnerConnections, partnerEvents, partnerOrders, partnerOutbox, shipments, type PartnerConnection } from "@/db/schema";
import { notify } from "../notify";
import { ctxOf, labelUrl, statusFor, trackingUrl } from "./config";
import { getAdapter } from "./registry";
import { onOutboxQueued } from "./sync";
import { orderAttempts } from "./orders-core";
import { PartnerError, type JrEvent, type PushJob } from "./types";

/** Retry schedule in minutes after a retryable failure (partner down / timeout); then the update is parked as "dead" for a human. */
export const BACKOFF_MIN = [1, 5, 30, 120, 360];
const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);

export async function recordEvent(c: Pick<PartnerConnection, "id" | "businessId">, e: { direction: "in" | "out" | "lookup" | "test" | "poll"; kind: string; outcome?: "ok" | "ignored" | "error"; summary?: string; externalId?: string | null; shipmentId?: string | null; requestId?: string | null; partnerOrderId?: string | null; payload?: unknown; dedupeKey?: string | null }, x = db) {
  const rows = await x.insert(partnerEvents).values({
    connectionId: c.id, businessId: c.businessId, direction: e.direction, kind: e.kind, outcome: e.outcome ?? "ok", summary: e.summary?.slice(0, 300) ?? null,
    externalId: e.externalId ?? null, shipmentId: e.shipmentId ?? null, requestId: e.requestId ?? null, partnerOrderId: e.partnerOrderId ?? null, payload: (e.payload ?? null) as never, dedupeKey: e.dedupeKey ?? null,
  }).onConflictDoNothing().returning({ id: partnerEvents.id });
  return rows.length > 0;
}

export async function setHealth(id: string, ok: boolean, message: string | null) {
  await db.update(partnerConnections).set(ok ? { lastCheckedAt: new Date(), lastOkAt: new Date(), lastError: null } : { lastCheckedAt: new Date(), lastError: message?.slice(0, 300) ?? "error" }).where(eq(partnerConnections.id, id));
}

/**
 * Sends due write-backs. Strict order per order/parcel: an entry waits while an earlier one of the same line is still queued or retrying,
 * so a partner never sees "delivered" before "picked up". A dead entry does not block the ones after it (the partner gets the latest).
 */
export async function processPartnerOutbox(limit = 25, connectionId?: string) {
  // Rounds: sending an entry unblocks the next one of the same line, so keep going (bounded) instead of waiting for the next tick.
  const total = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const down = new Map<string, number>();
  for (let round = 0; round < 12 && total.processed < limit * 4; round++) {
    const r = await outboxRound(limit, connectionId, down);
    total.processed += r.processed; total.sent += r.sent; total.failed += r.failed; total.skipped += r.skipped;
    // Another round only if something finished (sent / skipped / given up): that is what unblocks the next update of a line.
    if (!r.processed || r.sent + r.skipped + r.dead === 0) break;
  }
  return total;
}

/** The same order / parcel = the same line (rows queued before the order row existed carry only the parcel id). */
const SAME_LINE = sql`((o.partner_order_id is not null and p.partner_order_id = o.partner_order_id) or (o.shipment_id is not null and p.shipment_id = o.shipment_id))`;
const PER_CONNECTION = 10; // fairness: one busy (or slow) partner cannot take a whole round

const BREAKER = 3; // consecutive "unavailable" answers before a partner is skipped for the rest of the run

async function outboxRound(limit: number, connectionId?: string, down = new Map<string, number>()) {
  const due = (await db.execute(sql`
    select id, connection_id from (
      select o.id, o.connection_id, o.seq, row_number() over (partition by o.connection_id order by o.seq) as rn
      from partner_outbox o
      where o.status in ('queued', 'retry_wait') and o.next_attempt_at <= now() ${connectionId ? sql`and o.connection_id = ${connectionId}` : sql``}
        and not exists (select 1 from partner_outbox p where p.connection_id = o.connection_id and p.status in ('queued', 'retry_wait') and p.seq < o.seq and ${SAME_LINE})
    ) d where d.rn <= ${PER_CONNECTION} order by d.seq limit ${limit}`)).rows as Array<{ id: string; connection_id: string }>;
  let sent = 0, failed = 0, skipped = 0, processed = 0, dead = 0;
  for (const { id, connection_id } of due) {
    if ((down.get(connection_id) ?? 0) >= BREAKER) continue; // circuit breaker: this partner is unreachable in this run — serve the others
    const claim = await db.update(partnerOutbox).set({ attempts: sql`${partnerOutbox.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
      .where(and(eq(partnerOutbox.id, id), inArray(partnerOutbox.status, ["queued", "retry_wait"]), sql`${partnerOutbox.nextAttemptAt} <= now()`)).returning();
    if (!claim.length) continue;
    processed++;
    const o = claim[0];
    const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, o.connectionId));
    let result: { skipped?: string } | null = null, job: PushJob | null = null, failure: unknown = null;
    try {
      if (!c || c.status !== "active") { await db.update(partnerOutbox).set({ status: "skipped", lastError: "connection disabled or removed" }).where(eq(partnerOutbox.id, o.id)); skipped++; continue; }
      const a = getAdapter(c.provider);
      if (!a?.push) throw new PartnerError("config", "This system cannot receive updates");
      job = await buildJob(c, o);
      result = job.status === null && a.statusOut?.length && o.action !== "accepted"
        ? { skipped: `no ${a.label} status is mapped to "${o.action}"` }
        : await a.push(ctxOf(c), job);
      await db.update(partnerOutbox).set({ status: result.skipped ? "skipped" : "sent", sentAt: new Date(), lastError: result.skipped ?? null }).where(eq(partnerOutbox.id, o.id));
    } catch (e) { failure = e; }
    if (failure === null && result && c && job) {
      down.delete(c.id);
      // Bookkeeping after a successful send: its failure must never re-queue an update the partner already has.
      if (result.skipped) skipped++; else sent++;
      try {
        const a = getAdapter(c.provider)!;
        const ref = job.order?.awb ?? job.order?.externalRef ?? job.shipment?.externalRef ?? null;
        await recordEvent(c, { direction: "out", kind: o.action, outcome: result.skipped ? "ignored" : "ok", summary: result.skipped ?? `${a.label}: ${o.action}${job.status ? ` → ${job.status}` : ""}${ref ? ` for ${ref}` : ""}`, shipmentId: o.shipmentId, requestId: o.requestId, partnerOrderId: o.partnerOrderId, externalId: ref, payload: { status: job.status, attempt: o.attempts } });
        if (!result.skipped) await setHealth(c.id, true, null);
      } catch { /* the update itself went out */ }
      continue;
    }
    if (failure === null) continue;
    failed++;
    const e = failure;
    const retryable = !(e instanceof PartnerError) || e.kind === "unavailable";
    if (c) { if (retryable) down.set(c.id, (down.get(c.id) ?? 0) + 1); else down.delete(c.id); }
    const isDead = !retryable || o.attempts > BACKOFF_MIN.length;
    if (isDead) dead++;
    await db.update(partnerOutbox).set({ status: isDead ? "dead" : "retry_wait", lastError: msg(e), nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[Math.min(o.attempts - 1, BACKOFF_MIN.length - 1)] ?? 360) * 60_000) }).where(eq(partnerOutbox.id, o.id));
    if (c) {
      try {
        await recordEvent(c, { direction: "out", kind: o.action, outcome: "error", summary: msg(e), shipmentId: o.shipmentId, requestId: o.requestId, partnerOrderId: o.partnerOrderId });
        await setHealth(c.id, false, msg(e));
        if (isDead) await notify(c.businessId, "partner_sync_failed", { provider: getAdapter(c.provider)?.label ?? c.provider, connection: c.name, connectionId: c.id });
      } catch { /* logging only */ }
    }
  }
  return { processed, sent, failed, skipped, dead };
}

async function buildJob(c: PartnerConnection, o: typeof partnerOutbox.$inferSelect): Promise<PushJob> {
  const a = getAdapter(c.provider)!;
  const [order] = o.partnerOrderId ? await db.select().from(partnerOrders).where(eq(partnerOrders.id, o.partnerOrderId)) : [];
  const [s] = o.shipmentId ? await db.select().from(shipments).where(eq(shipments.id, o.shipmentId)) : [];
  const legacy = (o.payload ?? {}) as Record<string, unknown>; // rows queued before v2 carried the parcel snapshot in the payload
  const p = o.payload as { at?: string; note?: string | null; driver?: string | null };
  const action = o.action as JrEvent;
  const awb = order?.awb ?? null;
  return {
    action, status: statusFor(c, a, action), at: p.at ?? o.createdAt.toISOString(),
    order: order ? { id: order.id, externalId: order.externalId, externalRef: order.externalRef, awb, invoice: order.invoice, extra: (order.extra ?? {}) as Record<string, unknown> } : null,
    shipment: s ? {
      id: s.id, code: s.code, externalRef: s.externalRef, failReason: s.failReason, failNote: s.failNote, deliveredAt: s.deliveredAt?.toISOString() ?? null,
      proofType: s.proofType, attempts: s.attempts, codCollectedCents: s.codCollectedCents, receiverName: s.receiverName,
    } : legacy.code ? {
      id: String(legacy.id ?? o.shipmentId), code: String(legacy.code), externalRef: (legacy.externalRef as string) ?? null, failReason: (legacy.failReason as string) ?? null, failNote: (legacy.failNote as string) ?? null,
      deliveredAt: (legacy.deliveredAt as string) ?? null, proofType: (legacy.proofType as string) ?? null, attempts: 0, codCollectedCents: null, receiverName: null,
    } : null,
    driver: p.driver ? { name: p.driver } : null,
    links: { label: awb ? labelUrl(awb) : null, tracking: awb ? trackingUrl(awb) : null },
    note: p.note ?? null,
    attempts: order ? (await orderAttempts(c.id, order)).total : s?.attempts,
  };
}

export async function retryOutboxRow(businessId: string | null, outboxId: string) {
  const [o] = await db.select().from(partnerOutbox).where(and(eq(partnerOutbox.id, outboxId), businessId ? eq(partnerOutbox.businessId, businessId) : undefined));
  if (!o) return null;
  if (!["dead", "skipped"].includes(o.status)) return "not_failed" as const;
  // Re-sending an old step after a newer one already reached the partner would move the order backwards there.
  const newer = (await db.execute(sql`select 1 from partner_outbox p, (select ${o.partnerOrderId}::uuid as partner_order_id, ${o.shipmentId}::uuid as shipment_id) o
    where p.connection_id = ${o.connectionId} and p.seq > ${o.seq} and p.status = 'sent' and ${SAME_LINE} limit 1`)).rows.length > 0;
  if (newer) return "superseded" as const;
  await db.update(partnerOutbox).set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(partnerOutbox.id, o.id));
  return o;
}

// Low-latency send: a debounced in-process run shortly after something was queued (the scheduler tick remains the safety net).
let timer: NodeJS.Timeout | null = null;
if (process.env.NODE_ENV !== "test") {
  onOutboxQueued((delayMs = 2000) => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; void processPartnerOutbox(50).catch(() => undefined); }, delayMs);
    timer.unref?.();
  });
}

/**
 * Retention for what only ever grows (runs with the housekeeping tick): the audit trail of partner traffic is kept 180 days, delivered /
 * skipped write-backs 90 days. Failed ("dead") updates stay until someone retries them or they are 180 days old. Orders are kept.
 */
export async function prunePartnerData(now = new Date()) {
  const day = 864e5;
  const ev = await db.delete(partnerEvents).where(sql`${partnerEvents.createdAt} < ${new Date(now.getTime() - 180 * day)}`).returning({ id: partnerEvents.id });
  const ob = await db.delete(partnerOutbox).where(sql`(${partnerOutbox.status} in ('sent', 'skipped') and ${partnerOutbox.createdAt} < ${new Date(now.getTime() - 90 * day)}) or (${partnerOutbox.status} = 'dead' and ${partnerOutbox.createdAt} < ${new Date(now.getTime() - 180 * day)})`).returning({ id: partnerOutbox.id });
  return { events: ev.length, updates: ob.length };
}
