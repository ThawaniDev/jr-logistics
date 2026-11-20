import { sql, type SQL } from "drizzle-orm";
import { requests } from "@/db/schema";
import { anyWindow, inWindow, NOT_DRAFT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import type { SpeedStep } from "./ops-kinds";
import { DRIVEN, FILLED, G_ACCEPT, G_FILL, G_OFFER, RESOLVED, SLOTS } from "./ops-sql";
import { type Row } from "./ops-util";
import { histogramFromRow, histogramSelect } from "./stats";

/** Edges (seconds) of the time-to-staff histograms: < 15 min, 15–30 min, 30–60 min, 1–2 h, 2–6 h, 6–24 h, ≥ 24 h (same as the Overview's time to fill). */
export const STAFF_EDGES = [900, 1800, 3600, 7200, 21_600, 86_400];

/**
 * Demand and fill facts of the requests CREATED in the period (drafts excluded), current and comparison window in one pass.
 * Fill measures cover requests that look for drivers whose staffing outcome is known (`RESOLVED`).
 */
export async function demandFacts(f: ResolvedFilters) {
  const c = (extra: SQL) => (w: (col: string) => SQL) => sql`count(*) filter (where ${w("requests.created_at")} and ${extra})::int`;
  const sum = (expr: SQL) => (w: (col: string) => SQL) => sql`coalesce(sum(${expr}) filter (where ${w("requests.created_at")} and ${DRIVEN} and ${RESOLVED}), 0)::float8`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      created: c(sql`true`), published: c(sql`requests.published_at is not null`), cancelled: c(sql`requests.status = 'cancelled'`), expired: c(sql`requests.status = 'expired'`),
      completed: c(sql`requests.status = 'completed'`), driven: c(DRIVEN), cohort: c(sql`${DRIVEN} and ${RESOLVED}`),
      full: c(sql`${DRIVEN} and ${RESOLVED} and requests.slots_filled >= ${SLOTS}`), slots: sum(SLOTS), filled: sum(FILLED),
      aon: c(sql`${DRIVEN} and requests.allow_partial = false`), aon_failed: c(sql`${DRIVEN} and requests.allow_partial = false and requests.status = 'cancelled' and requests.cancel_reason = 'not_fully_staffed'`),
    })}
    from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}`);
  const p = (k: string) => twinRead(r, k);
  return { created: p("created"), published: p("published"), cancelled: p("cancelled"), expired: p("expired"), completed: p("completed"), driven: p("driven"), cohort: p("cohort"), full: p("full"), slots: p("slots"), filled: p("filled"), aon: p("aon"), aonFailed: p("aon_failed") };
}

/**
 * How fast requests get staffed: seconds from publishing to the first offer, the first acceptance and the last slot being filled (p50 and p90, both windows),
 * and histograms of the last two for the current period. Reads the milestone columns captured since migration 0012 (back-filled), falling back to the offers.
 */
export async function speedFacts(f: ResolvedFilters) {
  const inCur = inWindow("x.created_at", f.cur);
  const pct = (p: number, col: string) => (w: (c: string) => SQL) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${sql.raw(col)}) filter (where ${w("x.created_at")})`;
  const n = (col: string) => (w: (c: string) => SQL) => sql`count(${sql.raw(col)}) filter (where ${w("x.created_at")})::int`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      offer_p50: pct(0.5, "x.g_offer"), offer_p90: pct(0.9, "x.g_offer"), offer_n: n("x.g_offer"),
      accept_p50: pct(0.5, "x.g_accept"), accept_p90: pct(0.9, "x.g_accept"), accept_n: n("x.g_accept"),
      fill_p50: pct(0.5, "x.g_fill"), fill_p90: pct(0.9, "x.g_fill"), fill_n: n("x.g_fill"),
    })}, ${histogramSelect(sql`x.g_accept`, STAFF_EDGES, "ha", inCur)}, ${histogramSelect(sql`x.g_fill`, STAFF_EDGES, "hf", inCur)}
    from (
      select requests.created_at, ${G_OFFER} as g_offer, ${G_ACCEPT} as g_accept, ${G_FILL} as g_fill
      from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${DRIVEN} and requests.published_at is not null and ${anyWindow(f, requests.createdAt)}
    ) x`);
  const read = (step: SpeedStep) => ({ p50: twinRead(r, `${step}_p50`), p90: twinRead(r, `${step}_p90`), n: twinRead(r, `${step}_n`).cur ?? 0 });
  return { offer: read("offer"), accept: read("accept"), fill: read("fill"), acceptHistogram: histogramFromRow(r ?? {}, STAFF_EDGES, "ha"), fillHistogram: histogramFromRow(r ?? {}, STAFF_EDGES, "hf") };
}
export type SpeedFacts = Awaited<ReturnType<typeof speedFacts>>;
