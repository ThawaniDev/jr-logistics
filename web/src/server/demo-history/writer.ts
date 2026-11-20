import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Exec } from "@/db";
import * as S from "@/db/schema";
import { post } from "@/server/wallet";

/**
 * Bulk writing for the generator. Rows are buffered per table and flushed in foreign-key order, one statement per ≤ 1 500 rows, as
 * `insert … select … from jsonb_populate_recordset(null::table, $1::jsonb)` — a single parameter however wide the table is, so a few
 * hundred thousand rows cost seconds. Columns a row leaves out take the column's own default (the union of the chunk's keys is inserted;
 * rows that lack one of them get NULL, or the column's constant default, and a missing NOT NULL timestamp is a generator bug that throws).
 */
export const TABLES = {
  users: S.users, termsConsents: S.termsConsents, walletAccounts: S.walletAccounts, businessProfiles: S.businessProfiles, officeProfiles: S.officeProfiles, driverProfiles: S.driverProfiles,
  officeAgreements: S.officeAgreements, officeInvites: S.officeInvites, documents: S.documents, apiKeys: S.apiKeys,
  requests: S.requests, offers: S.offers, shipments: S.shipments, shipmentMedia: S.shipmentMedia, settlements: S.settlements, invoices: S.invoices, codRemittances: S.codRemittances, withdrawals: S.withdrawals,
  jobEvents: S.jobEvents, shipmentEvents: S.shipmentEvents, messages: S.messages, ratings: S.ratings, custodyItems: S.custodyItems,
  tickets: S.tickets, ticketReplies: S.ticketReplies, ticketAttachments: S.ticketAttachments, complaints: S.complaints, complaintNotes: S.complaintNotes,
  notifications: S.notifications, auditLogs: S.auditLogs, loginEvents: S.loginEvents, driverAvailabilityLog: S.driverAvailabilityLog, driverLocationHistory: S.driverLocationHistory,
  messageLog: S.messageLog, webhookDeliveries: S.webhookDeliveries, entityNotes: S.entityNotes, metricSnapshots: S.metricSnapshots,
} as const;
export type TableName = keyof typeof TABLES;
export type Insert<K extends TableName> = (typeof TABLES)[K]["$inferInsert"];

/** Parents before children. `flush()` always writes in this order, so every foreign key finds its row. */
export const FLUSH_ORDER: TableName[] = [
  "users", "walletAccounts", "businessProfiles", "officeProfiles", "driverProfiles", "termsConsents", "officeAgreements", "officeInvites", "documents", "apiKeys",
  "requests", "offers", "shipments", "shipmentMedia", "settlements", "invoices", "codRemittances", "withdrawals", "jobEvents", "shipmentEvents", "messages", "ratings", "custodyItems",
  "tickets", "ticketReplies", "ticketAttachments", "complaints", "complaintNotes",
  "notifications", "auditLogs", "loginEvents", "driverAvailabilityLog", "driverLocationHistory", "messageLog", "webhookDeliveries", "entityNotes", "metricSnapshots",
];

type Rec = Record<string, unknown>;
const CHUNK = 1500;

export async function bulkInsert(x: Exec, table: PgTable, rows: Rec[]): Promise<void> {
  if (!rows.length) return;
  const cols = getTableColumns(table) as Record<string, { name: string; notNull: boolean; hasDefault: boolean; default?: unknown; dataType: string }>;
  const tname = getTableName(table);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const keys = [...new Set(chunk.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
    for (const k of keys) if (!cols[k]) throw new Error(`demo-history: ${tname} has no column "${k}"`);
    const payload = chunk.map((r) => {
      const o: Rec = {};
      for (const k of keys) {
        const c = cols[k];
        let v = r[k];
        if (v === undefined) {
          if (!c.notNull) v = null;
          else if (c.hasDefault && c.default !== undefined && typeof c.default !== "object") v = c.default;
          else throw new Error(`demo-history: ${tname}.${c.name} is NOT NULL but a generated row has no value for it`);
        }
        o[c.name] = v instanceof Date ? (Number.isNaN(v.getTime()) ? (() => { throw new Error(`demo-history: invalid date in ${tname}.${c.name}`); })() : v.toISOString()) : v;
      }
      return o;
    });
    const ids = keys.map((k) => sql.identifier(cols[k].name));
    await x.execute(sql`insert into ${sql.identifier(tname)} (${sql.join(ids, sql`, `)}) select ${sql.join(ids, sql`, `)} from jsonb_populate_recordset(null::${sql.identifier(tname)}, ${JSON.stringify(payload)}::jsonb)`);
  }
}

/** One ledger posting, to be applied through the platform's own `post()` in time order. */
export interface Posting {
  at: number; accountId: string; kind: string; available?: number; reserved?: number; held?: number; key: string;
  requestId?: string | null; offerId?: string | null; settlementId?: string | null; actorId?: string | null; note?: string | null; simulated?: boolean;
}

/** Buffers rows per table; in `count` mode (dry run) it only counts. */
export class Sink {
  readonly counts: Record<string, number> = {};
  private buf = new Map<TableName, Rec[]>();
  private buffered = 0;
  constructor(readonly mode: "write" | "count" = "write", private threshold = 40_000) {}
  add<K extends TableName>(t: K, row: Insert<K>): void {
    for (const [k, v] of Object.entries(row as Rec)) if (v instanceof Date && Number.isNaN(v.getTime())) throw new Error(`demo-history: invalid date in ${t}.${k}`);
    this.counts[t] = (this.counts[t] ?? 0) + 1;
    if (this.mode === "count") return;
    let b = this.buf.get(t);
    if (!b) { b = []; this.buf.set(t, b); }
    b.push(row as Rec);
    this.buffered++;
  }
  get pending() { return this.buffered; }
  /** The rows buffered for a table (tests / diagnostics). */
  peek<K extends TableName>(t: K): Array<Insert<K>> { return (this.buf.get(t) ?? []) as Array<Insert<K>>; }
  needsFlush() { return this.buffered >= this.threshold; }
  async flush(x: Exec): Promise<void> {
    if (this.mode === "count") return;
    for (const t of FLUSH_ORDER) {
      const rows = this.buf.get(t);
      if (!rows?.length) continue;
      await bulkInsert(x, TABLES[t], rows);
      this.buf.set(t, []);
    }
    this.buffered = 0;
  }
}

/**
 * Applies postings through `post()` (balance + ledger row, atomically, with the platform's own overdraft check), in the order given,
 * then back-dates the ledger rows to the moment each posting belongs to (post() stamps "now").
 */
export async function applyPostings(x: Exec, postings: Posting[], progress?: (done: number, total: number) => void): Promise<{ applied: number }> {
  let applied = 0;
  const stamp: Array<{ k: string; t: string }> = [];
  for (let i = 0; i < postings.length; i++) {
    const p = postings[i];
    const r = await post(x, { accountId: p.accountId, kind: p.kind, available: p.available, reserved: p.reserved, held: p.held, idempotencyKey: p.key, requestId: p.requestId, offerId: p.offerId, settlementId: p.settlementId, actorId: p.actorId, note: p.note ?? undefined, simulated: p.simulated ?? false });
    if (r.applied) applied++;
    stamp.push({ k: p.key, t: new Date(p.at).toISOString() });
    if (stamp.length >= 2000) { await restamp(x, stamp.splice(0)); }
    if (progress && i % 5000 === 0) progress(i, postings.length);
  }
  if (stamp.length) await restamp(x, stamp);
  return { applied };
}
async function restamp(x: Exec, rows: Array<{ k: string; t: string }>) {
  await x.execute(sql`update ledger_entries l set created_at = v.t from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as v(k text, t timestamptz) where l.idempotency_key = v.k`);
}
