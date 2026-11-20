import { DAILY_KEYS, HOURLY_KEYS } from "@/server/snapshots";
import { DAY, HOUR, hourStart, ksaDayStart } from "./calendar";
import type { Metrics } from "./acc";
import { isOnline } from "./schedule";
import type { MoneyResult } from "./money";
import type { Ctx } from "./types";

/**
 * Hourly (last 30 days) and daily (whole window) snapshots, per city and for the platform — the same keys, with the same definitions, as the
 * maintenance tick writes (`server/snapshots.ts`), computed from the simulated history instead of being captured live. Today's day and the current hour
 * are left out on purpose: the real tick writes those.
 */
export interface SnapshotRow { scope: "hour" | "day"; at: number; city: string | null; metrics: Metrics }

export function buildSnapshots(ctx: Ctx, money: MoneyResult): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const seed = ctx.opts.seed;
  const fill = (m: Map<string, Metrics>, keys: readonly string[]) => { if (!m.has("")) m.set("", {}); for (const r of m.values()) for (const k of keys) r[k] ??= 0; return m; };

  // ── hourly ──
  const h1 = hourStart(ctx.asOf), h0 = hourStart(ctx.asOf - 30 * DAY);
  for (let h = Math.max(h0, hourStart(ctx.windowStart)); h < h1; h += HOUR) {
    for (const d of ctx.w.drivers) {
      if (d.status === "suspended" && d.suspendedAt != null && d.suspendedAt <= h) continue; // users.status = 'active' only
      if (h < d.createdAt) continue;
      const busy = d.jobs.some((j) => j.acc <= h && h < j.end);
      ctx.acc.add(h, d.city, "drivers_available", d.verification !== "pending" && d.verification !== "rejected" && isOnline(d, seed, h) ? 1 : 0);
      ctx.acc.add(h, d.city, "drivers_busy", busy ? 1 : 0);
    }
    const m = fill(ctx.acc.hours.get(h) ?? new Map(), HOURLY_KEYS);
    for (const [city, metrics] of m) rows.push({ scope: "hour", at: h, city: city || null, metrics });
  }

  // ── daily ──
  const cod = ctx.iv.cod.slice().sort((a, b) => a.at - b.at), remit = ctx.iv.remit.slice().sort((a, b) => a.at - b.at);
  for (let day = ksaDayStart(ctx.windowStart); day + DAY <= ctx.asOf + 1; day += DAY) {
    const end = day + DAY - 1;
    const m = new Map<string, Metrics>();
    const add = (city: string, k: string, v: number) => { for (const key of city ? [city, ""] : [""]) { const r = m.get(key) ?? {}; r[k] = (r[k] ?? 0) + v; m.set(key, r); } };
    for (const c of ctx.w.companies) if (c.createdAt <= end) add(c.city, "companies_active", c.verifiedAt != null && c.verifiedAt <= end && (c.suspendedAt == null || c.suspendedAt > end) && (c.verification === "verified" || c.verification === "suspended") ? 1 : 0);
    for (const d of ctx.w.drivers) if (d.createdAt <= end) add(d.city, "drivers_active", d.verifiedAt != null && d.verifiedAt <= end && (d.verification === "verified" || (d.verification === "expired" && end < d.activeTo)) && !(d.status === "suspended" && d.suspendedAt != null && d.suspendedAt <= end) ? 1 : 0);
    for (const o of ctx.w.offices) if (o.createdAt <= end) add(o.city, "offices_active", o.verifiedAt != null && o.verifiedAt <= end && o.verification === "verified" ? 1 : 0);
    for (const x of ctx.iv.tickets) if (x.from <= end && end < x.to) add(x.city, "tickets_open", 1);
    for (const x of ctx.iv.complaints) if (x.from <= end && end < x.to) add(x.city, "complaints_open", 1);
    // wallet numbers come from the money pass (they depend on the order of every posting)
    const w = money.daily.get(day);
    if (w) for (const [city, metrics] of w) m.set(city, { ...(m.get(city) ?? {}), ...metrics });
    const plat = m.get("") ?? {};
    const sumTo = (list: Array<{ at: number; cents: number }>) => { let s = 0; for (const x of list) { if (x.at > end) break; s += x.cents; } return s; };
    plat.cash_with_drivers_cents = sumTo(cod) - sumTo(remit);
    const sp = ctx.iv.settlementsPending.filter((x) => x.from <= end && end < x.to);
    plat.settlements_pending = sp.length; plat.settlements_pending_cents = sp.reduce((a, x) => a + x.cents, 0);
    const wd = ctx.iv.withdrawalsPending.filter((x) => x.from <= end && end < x.to);
    plat.withdrawals_pending = wd.length; plat.withdrawals_pending_cents = wd.reduce((a, x) => a + x.cents, 0);
    m.set("", plat);
    fill(m, DAILY_KEYS);
    for (const [city, metrics] of m) rows.push({ scope: "day", at: day, city: city || null, metrics });
  }
  return rows;
}
