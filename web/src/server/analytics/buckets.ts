import { sql, type SQL } from "drizzle-orm";
import type { Bucket } from "./periods";

export { bucketKeys, autoBucket } from "./periods";

/**
 * SQL for the bucket a timestamp falls into, in RIYADH time (`at time zone 'Asia/Riyadh'`), as the same text key `bucketKeys()` produces:
 * hour `2026-11-19T14`, day `2026-11-19`, week/month `YYYY-MM-DD` of the bucket's first day. WEEKS START ON SUNDAY (the Saudi working week is Sun–Thu),
 * so the week is truncated by shifting one day forward (Postgres truncates to Monday) and back again.
 */
export function bucketSql(col: SQL | { _: unknown } | string, b: Bucket): SQL {
  const c = typeof col === "string" ? sql.raw(col) : (col as SQL);
  const local = sql`(${c} at time zone 'Asia/Riyadh')`;
  switch (b) {
    case "hour": return sql`to_char(date_trunc('hour', ${local}), 'YYYY-MM-DD"T"HH24')`;
    case "day": return sql`to_char(date_trunc('day', ${local}), 'YYYY-MM-DD')`;
    case "week": return sql`to_char(date_trunc('week', ${local} + interval '1 day') - interval '1 day', 'YYYY-MM-DD')`;
    case "month": return sql`to_char(date_trunc('month', ${local}), 'YYYY-MM-DD')`;
  }
}

/** Riyadh weekday (0 = Sunday) and hour (0–23) of a timestamp: the axes of the weekday × hour heatmap. */
export const riyadhDow = (col: SQL | { _: unknown }) => sql`extract(dow from (${col as SQL} at time zone 'Asia/Riyadh'))::int`;
export const riyadhHour = (col: SQL | { _: unknown }) => sql`extract(hour from (${col as SQL} at time zone 'Asia/Riyadh'))::int`;

export type Point<K extends string> = { t: string } & Record<K, number>;
/**
 * Turns sparse grouped rows (`{ t, <field>… }`, only buckets that had data) into one point per bucket key, with 0 where there was none, so a chart never has holes.
 * Missing or non-numeric fields become 0; rows whose key is outside `keys` are dropped (cannot happen for rows read with the same window and bucket).
 */
export function zeroFill<K extends string>(keys: string[], rows: Array<{ t: string } & Partial<Record<K, unknown>>>, fields: readonly K[]): Array<Point<K>> {
  const byKey = new Map(rows.map((r) => [r.t, r]));
  return keys.map((t) => {
    const r = byKey.get(t);
    const p = { t } as Point<K>;
    for (const k of fields) { const v = Number(r?.[k] ?? 0); (p as Record<string, number>)[k] = Number.isFinite(v) ? v : 0; }
    return p;
  });
}
