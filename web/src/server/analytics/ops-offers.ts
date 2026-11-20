import { sql, type SQL } from "drizzle-orm";
import { offers } from "@/db/schema";
import { anyWindow, inWindow, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { FUNNEL_STEPS, OFFER_OUTCOMES } from "./ops-kinds";
import { DRIVEN, FOLLOW_ON, LOST_JOB, WORK_DONE } from "./ops-sql";
import { type Row } from "./ops-util";
import { histogramFromRow, histogramSelect } from "./stats";

/** Edges (seconds) of the driver response-time histogram: < 1 min, 1–5 min, 5–15 min, 15–30 min, 30–60 min, 1–2 h, ≥ 2 h. */
export const RESPONSE_EDGES = [60, 300, 900, 1800, 3600, 7200];
export { FUNNEL_STEPS, OFFER_OUTCOMES } from "./ops-kinds";

/** Seconds a driver took to answer an offer (accepted → acceptance time, declined → decline time). Direct applications (`source = 'apply'`) did not wait for an offer. */
const RESPONSE_S = sql`(case when offers.source <> 'apply' then case when offers.accepted_at is not null then extract(epoch from (offers.accepted_at - offers.created_at)) when offers.status = 'rejected' then extract(epoch from (offers.updated_at - offers.created_at)) end end)::float8`;

/**
 * Offers SENT in the period (by their creation time): the offered → accepted → arrived → loaded → completed funnel, where the rest ended (decline, expiry,
 * driver cancellation, no-show, replacement, request called off), how fast drivers answered, how many jobs were assigned by hand, and how many accepted jobs lost their driver.
 */
export async function offerFacts(f: ResolvedFilters) {
  const c = (cond: SQL) => (w: (col: string) => SQL) => sql`count(*) filter (where ${w("offers.created_at")} and ${cond})::int`;
  const pct = (p: number) => (w: (col: string) => SQL) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${RESPONSE_S}) filter (where ${w("offers.created_at")})`;
  const inCur = inWindow(offers.createdAt, f.cur);
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      offered: c(sql`true`), accepted: c(sql`offers.accepted_at is not null`), arrived: c(sql`offers.arrived_at is not null`), loaded: c(sql`offers.loaded_at is not null`), done: c(WORK_DONE),
      rejected: c(sql`offers.status = 'rejected'`), expired: c(sql`offers.status = 'expired' and offers.accepted_at is null`),
      cancelled: c(sql`offers.status = 'cancelled' and coalesce(offers.cancel_reason, '') not in ${FOLLOW_ON}`), request_ended: c(sql`offers.status = 'cancelled' and coalesce(offers.cancel_reason, '') in ${FOLLOW_ON}`),
      no_show: c(sql`offers.status = 'no_show'`), replaced: c(sql`offers.status = 'replaced'`), manual: c(sql`offers.accepted_at is not null and offers.source = 'manual'`), lost: c(LOST_JOB),
      resp_p50: pct(0.5), resp_p90: pct(0.9), resp_n: c(sql`${RESPONSE_S} is not null`),
    })}, ${histogramSelect(RESPONSE_S, RESPONSE_EDGES, "hr", inCur)}
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${DRIVEN} and ${anyWindow(f, offers.createdAt)}`);
  const p = (k: string) => twinRead(r, k);
  return {
    offered: p("offered"), accepted: p("accepted"), arrived: p("arrived"), loaded: p("loaded"), done: p("done"), rejected: p("rejected"), expired: p("expired"), cancelled: p("cancelled"),
    requestEnded: p("request_ended"), noShow: p("no_show"), replaced: p("replaced"), manual: p("manual"), lost: p("lost"),
    response: { p50: p("resp_p50"), p90: p("resp_p90"), n: p("resp_n").cur ?? 0, histogram: histogramFromRow(r ?? {}, RESPONSE_EDGES, "hr") },
  };
}
export type OfferFacts = Awaited<ReturnType<typeof offerFacts>>;

/** The funnel (offered → completed): each step is clamped to the step before it, so a quirk in the data can never show a step larger than its predecessor. */
export function funnelOf(o: Pick<OfferFacts, "offered" | "accepted" | "arrived" | "loaded" | "done">): Array<{ key: (typeof FUNNEL_STEPS)[number]; count: number }> {
  const raw = [o.offered, o.accepted, o.arrived, o.loaded, o.done].map((x) => num(x.cur));
  return raw.map((n, i) => ({ key: FUNNEL_STEPS[i], count: Math.min(n, ...raw.slice(0, i)) }));
}

/** Where the offers of the current period ended; `active` is what is left (still waiting or in progress), never negative. */
export function outcomesOf(o: OfferFacts): Array<{ key: (typeof OFFER_OUTCOMES)[number]; count: number }> {
  const v = (x: { cur: number | null }) => num(x.cur);
  const known = { completed: v(o.done), rejected: v(o.rejected), expired: v(o.expired), cancelled: v(o.cancelled), no_show: v(o.noShow), replaced: v(o.replaced), request_ended: v(o.requestEnded) };
  const active = Math.max(0, v(o.offered) - Object.values(known).reduce((s, n) => s + n, 0));
  return OFFER_OUTCOMES.map((key) => ({ key, count: key === "active" ? active : known[key as keyof typeof known] }));
}
