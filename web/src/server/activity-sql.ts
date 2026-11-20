import { sql, type SQL } from "drizzle-orm";
import type { ActivityActor, ActivityEntity, ActivityKind, ActivityRef, SourceGroup } from "./activity-core";

/**
 * Building blocks of the activity sources. Every source is ONE normalised SELECT per entity scope:
 *   id text · at timestamptz · actor_id uuid · actor_name text · actor_role text · type text · txt text (searchable) · data jsonb
 * The engine wraps it with the shared filters (period, actor, text) and ORDER BY at DESC LIMIT n, so each source costs one index-backed query.
 */
export interface Ctx {
  entity: ActivityEntity; id: string;
  /** The request this entity belongs to (offer / shipment / settlement …). */
  requestId?: string | null; offerId?: string | null; ref?: string | null;
  /** Users whose notifications can mention this entity (ticket opener / handler …). */
  userIds?: string[]; label?: string | null; role?: string | null; phone?: string | null; email?: string | null;
}
/** The `data` column is built by `jsonb_build_object(…)` right next to each `map()`, so its shape is known there; it is read loosely on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;
export interface Row { id: string; at: Date | string; actor_id: string | null; actor_name: string | null; actor_role: string | null; type: string; txt: string; data: Data | null }
export interface Mapped { titleKey: string; params?: Record<string, unknown>; refs?: ActivityRef[]; details?: unknown; actor?: ActivityActor | null }
export interface Source {
  table: string; group: SourceGroup; kind: ActivityKind;
  /** True when the rows carry an actor (so the "by whom" filter can apply). */
  actor: boolean;
  build: Partial<Record<ActivityEntity, (c: Ctx) => SQL>>;
  map: (r: Row, c: Ctx) => Mapped;
}

/** `sel("e.id::text", …)`: the fixed column list every source must produce. Arguments are trusted SQL fragments written in this module. */
export const sel = (id: string, at: string, actorId: string, actorName: string, actorRole: string, type: string, txt: string, data: string) =>
  sql.raw(`${id} as id, ${at} as at, ${actorId} as actor_id, ${actorName} as actor_name, ${actorRole} as actor_role, ${type} as type, ${txt} as txt, ${data} as data`);
export const NO_ACTOR = ["null::uuid", "null::text", "null::text"] as const;
export const unionAll = (parts: SQL[]) => sql.join(parts.map((p) => sql`(${p})`), sql` union all `);
export const uuidOf = (id: string) => sql`${id}::uuid`;
/** Parameter list for `in (…)`. */
export const list = (vals: string[]) => sql.join(vals.map((v) => sql`${v}`), sql`, `);

/** Shared per-source filters. `kinds` is handled by the engine (it decides which sources run), the rest is applied inside the wrapper. */
export function filterSql(f: { actorId?: string; q?: string; from?: Date; to?: Date }): SQL {
  const parts: SQL[] = [];
  if (f.from) parts.push(sql`t.at >= ${f.from}`);
  if (f.to) parts.push(sql`t.at < ${f.to}`);
  if (f.actorId) parts.push(sql`t.actor_id = ${f.actorId}::uuid`);
  if (f.q) parts.push(sql`(t.type ilike ${"%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"} or t.txt ilike ${"%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"} or t.actor_name ilike ${"%" + f.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"})`);
  return parts.length ? sql` where ${sql.join(parts, sql` and `)}` : sql``;
}

const short = (v: unknown, n = 2000) => (typeof v === "string" && v.length > n ? v.slice(0, n) + "…" : v);
/** The primitive top-level fields of a payload (what a title can interpolate); nested objects stay in `details`. */
export function primitives(o: Data | null | undefined, keys?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) if ((!keys || keys.includes(k)) && v != null && typeof v !== "object") out[k] = short(v, 300);
  return out;
}
const REF_KEYS: Array<[string, ActivityRef["type"], string?]> = [
  ["requestId", "request", "requestRef"], ["offerId", "offer"], ["shipmentId", "shipment", "code"], ["ticketId", "ticket", "ticketRef"], ["complaintId", "complaint", "complaintRef"],
  ["settlementId", "settlement"], ["withdrawalId", "withdrawal"],
];
/** Links to the other things a row mentions (labels are filled in later in one batch). */
export function refsOf(data: Data | null | undefined, skip?: { type: string; id: string }): ActivityRef[] {
  const out: ActivityRef[] = [];
  for (const [k, type, label] of REF_KEYS) {
    const id = data?.[k];
    if (typeof id === "string" && id && !(skip && skip.type === type && skip.id === id)) out.push({ type, id, label: label && typeof data?.[label] === "string" ? data[label] : null });
  }
  return out;
}
export { short };
