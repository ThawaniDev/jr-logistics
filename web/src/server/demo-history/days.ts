import { DAY, DOW_FACTOR, HOUR, HOUR_WEIGHTS, holidayFactor, ksa, monthEndFactor, sampleMoment } from "./calendar";
import { simulateRequest } from "./lifecycle";
import { drawPlan } from "./plan";
import { clamp, unit, type Rng } from "./prng";
import type { CompanySim, Ctx } from "./types";

const GROWTH_PER_DAY = Math.log(1.8) / 180; // ≈ +80 % over half a year, before new companies are counted

/** How busy the platform is on one day: weekday, month-end salary week, holidays, long-run growth, a few random quiet days, day-to-day noise. */
export function demandFactor(seed: number, dayIndex: number, dayStart: number, noise: Rng): number {
  const dow = ksa(dayStart + 12 * HOUR).dow;
  const quiet = unit(seed, "quiet", dayIndex) < 0.014 ? 0.4 : 1;
  return DOW_FACTOR[dow] * monthEndFactor(dayStart) * holidayFactor(dayStart) * Math.exp(GROWTH_PER_DAY * dayIndex) * quiet * noise.logNormal(1, 0.12);
}

/**
 * The day loop: every active company places a Poisson number of requests per day (its own rate × the day's demand factor × a ramp-up after it
 * starts ordering), at times drawn from the two-peak hourly curve; each request is then simulated from draft to its end. `afterDay` lets the caller
 * flush buffered rows and report progress.
 */
export async function simulateDays(ctx: Ctx, afterDay?: (dayIndex: number) => Promise<void> | void): Promise<void> {
  const { opts, rng } = ctx;
  for (let di = 0; di < opts.days; di++) {
    const dayStart = ctx.windowStart + di * DAY;
    if (dayStart >= ctx.asOf) break;
    const dr = rng.fork(`day:${di}`);
    const f = demandFactor(opts.seed, di, dayStart, dr);
    const plans: Array<{ c: CompanySim; tc: number }> = [];
    for (const c of ctx.w.companies) {
      if (dayStart + DAY <= c.activeFrom || dayStart >= c.activeTo || !Number.isFinite(c.activeFrom)) continue;
      const ramp = clamp((dayStart - c.activeFrom) / (12 * DAY) + 0.4, 0.4, 1);
      const n = dr.poisson(c.lambda * f * ramp);
      for (let k = 0; k < n; k++) {
        const tc = sampleMoment(dr, dayStart, HOUR_WEIGHTS);
        if (tc >= ctx.asOf - 60_000 || tc < c.activeFrom) continue;
        plans.push({ c, tc });
      }
    }
    plans.sort((a, b) => a.tc - b.tc);
    for (const { c, tc } of plans) {
      const n = ctx.ids.seq("request");
      const rr = rng.fork(`req:${n}`);
      const plan = drawPlan(ctx, rr, n, c, tc);
      if (!plan) { ctx.stats.noPrice = (ctx.stats.noPrice ?? 0) + 1; continue; }
      simulateRequest(ctx, plan, rr);
    }
    if (afterDay) await afterDay(di);
  }
}
