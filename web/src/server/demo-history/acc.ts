import { HOUR } from "./calendar";

/** Accumulates the per-hour, per-city counts the hourly snapshots are made of. Every `add` also lands in the platform total (city ""). */
export type Metrics = Record<string, number>;
export class SnapshotAcc {
  readonly hours = new Map<number, Map<string, Metrics>>();
  add(hourStartMs: number, city: string, key: string, v = 1) {
    const h = Math.floor(hourStartMs / HOUR) * HOUR;
    let m = this.hours.get(h);
    if (!m) { m = new Map(); this.hours.set(h, m); }
    for (const c of city ? [city, ""] : [""]) {
      const row = m.get(c) ?? {};
      row[key] = (row[key] ?? 0) + v;
      m.set(c, row);
    }
  }
}
