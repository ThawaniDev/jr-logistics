import { GRID_DEG } from "./ops-kinds";
import { safeDiv } from "./kpi";

/** PURE helpers of the Geography report (grid cells, merging per-city facts); unit-tested, no database access. */
export { GRID_DEG };

/** The grid cell a coordinate falls into (integer indices of the south-west corner in units of `GRID_DEG`). */
export const cellOf = (lat: number, lng: number, deg = GRID_DEG): { gy: number; gx: number } => ({ gy: Math.floor(lat / deg), gx: Math.floor(lng / deg) });
/** Bounds and centre of a cell, rounded to 5 decimals (so floating point noise never reaches the UI or a CSV). */
export function cellBox(gy: number, gx: number, deg = GRID_DEG) {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { south: r(gy * deg), north: r((gy + 1) * deg), west: r(gx * deg), east: r((gx + 1) * deg), lat: r((gy + 0.5) * deg), lng: r((gx + 0.5) * deg) };
}
/** `24.725, 46.675`: a cell's centre as text (the zone name in tables, since a grid cell has no postal name). */
export const cellLabel = (gy: number, gx: number, deg = GRID_DEG) => { const b = cellBox(gy, gx, deg); return `${b.lat.toFixed(3)}, ${b.lng.toFixed(3)}`; };

export interface Cell { gy: number; gx: number; parcels: number; delivered: number; failed: number; city: string | null }
export interface ZoneRow extends Cell { id: string; zone: string; lat: number; lng: number; south: number; north: number; west: number; east: number; successRate: number | null; failureRate: number | null; share: number | null }
/** Zones from raw cells: centre, bounds, success / failure rate (delivered ÷ resolved) and share of all located parcels. */
export function zonesOf(cells: Cell[], totalParcels?: number): ZoneRow[] {
  const total = totalParcels ?? cells.reduce((s, c) => s + c.parcels, 0);
  return cells.map((c) => {
    const b = cellBox(c.gy, c.gx), resolved = c.delivered + c.failed;
    return { ...c, id: `${c.gy}:${c.gx}`, zone: `${b.lat.toFixed(3)}, ${b.lng.toFixed(3)}`, ...b, successRate: safeDiv(c.delivered, resolved), failureRate: safeDiv(c.failed, resolved), share: safeDiv(c.parcels, total) };
  });
}

/** A city's numbers as the tables show them. Counts are 0 when nothing happened; rates are null without a denominator. */
export interface CityRow {
  key: string; requests: number; prevRequests: number | null; pickupRequests: number; parcels: number; prevParcels: number | null; delivered: number; failed: number; returned: number;
  successRate: number | null; prevSuccessRate: number | null; failureRate: number | null; avgDeliverySecs: number | null; slots: number; filled: number; unserved: number; unservedRate: number | null;
  drivers: number; activeDrivers: number; activeCompanies: number; driversPerSlot: number | null; gmv: number | null; prevGmv: number | null; share: number | null;
}
export const blankCity = (key: string): CityRow => ({
  key, requests: 0, prevRequests: null, pickupRequests: 0, parcels: 0, prevParcels: null, delivered: 0, failed: 0, returned: 0, successRate: null, prevSuccessRate: null, failureRate: null, avgDeliverySecs: null,
  slots: 0, filled: 0, unserved: 0, unservedRate: null, drivers: 0, activeDrivers: 0, activeCompanies: 0, driversPerSlot: null, gmv: null, prevGmv: null, share: null,
});
/** Derives the ratios of a city row once all its counts are in, and each city's share of the parcels. Rows without any activity are dropped; busiest first. */
export function finishCities(rows: CityRow[]): CityRow[] {
  const total = rows.reduce((s, r) => s + r.parcels, 0);
  return rows.map((r) => {
    const resolved = r.delivered + r.failed + r.returned;
    return { ...r, failureRate: safeDiv(r.failed + r.returned, resolved), unserved: Math.max(0, r.slots - r.filled), unservedRate: safeDiv(Math.max(0, r.slots - r.filled), r.slots), driversPerSlot: safeDiv(r.drivers, r.slots), share: safeDiv(r.parcels, total) };
  }).filter((r) => r.requests || r.parcels || r.pickupRequests || r.activeDrivers)
    .sort((a, b) => b.parcels - a.parcels || b.requests - a.requests || a.key.localeCompare(b.key));
}
