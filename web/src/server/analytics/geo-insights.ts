import type { Insight } from "./insights";
import type { CityRow, ZoneRow } from "./geo-lib";
import type { Kpi } from "./kpi";

/** Observations on the Geography report (pure, unit-tested). Same contract as the Operations insights: `rpo.ins_geo_*` keys with `{placeholders}`, `refs` translated first. */
export interface GeoInsightInput { kpis: Kpi[]; cities: CityRow[]; zones: ZoneRow[]; located: number }
const SWING = ["requests_created", "parcels_delivered", "delivery_success", "geo_avg_delivery", "geo_unserved_slots"];
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const TONE = { bad: 0, info: 1, good: 2 } as const;

export function buildGeoInsights(i: GeoInsightInput): Insight[] {
  const out: Insight[] = [];
  const v = (key: string) => i.kpis.find((k) => k.key === key)?.value ?? null;
  const created = v("requests_created") ?? 0;
  if (created < 5) out.push({ key: "rpf.ins_sparse", tone: "info", vars: { n: created } });
  const swings = i.kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.15 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } });
  }

  const top = i.cities[0], share = v("geo_top_city_share");
  if (top && share != null && share >= 0.6 && i.cities.filter((c) => c.parcels > 0).length > 1) out.push({ key: "rpo.ins_geo_top_city", tone: "info", refs: { city: `city.${top.key}` }, vars: { n: pct1(share) } });
  const success = v("delivery_success");
  const weak = i.cities.filter((c) => c.delivered + c.failed + c.returned >= 10 && c.failureRate != null && c.failureRate >= 0.1 && (success == null || c.failureRate > 1 - success + 0.05)).sort((a, b) => b.failureRate! - a.failureRate!)[0];
  if (weak) out.push({ key: "rpo.ins_geo_fail_city", tone: "bad", refs: { city: `city.${weak.key}` }, vars: { n: pct1(weak.failureRate!) } });
  const short = i.cities.filter((c) => c.slots >= 5 && c.unservedRate != null && c.unservedRate >= 0.3).sort((a, b) => b.unservedRate! - a.unservedRate!)[0];
  if (short) out.push({ key: "rpo.ins_geo_unserved", tone: "bad", refs: { city: `city.${short.key}` }, vars: { n: pct1(short.unservedRate!), slots: short.unserved } });
  const geo = v("geo_geocoded");
  if (geo != null && geo < 0.8 && i.located + 1 >= 10) out.push({ key: "rpo.ins_geo_located_low", tone: "bad", vars: { n: pct1(geo) } });
  const cross = v("geo_cross_city");
  if (cross != null && cross >= 0.25) out.push({ key: "rpo.ins_geo_cross", tone: "info", vars: { n: pct1(cross) } });
  const zone = i.zones[0];
  if (zone && zone.parcels >= 5) out.push({ key: "rpo.ins_geo_zone", tone: "info", vars: { zone: zone.zone, n: zone.parcels, share: zone.share == null ? 0 : pct1(zone.share) } });

  return out.map((x, n) => ({ x, n })).sort((a, b) => TONE[a.x.tone] - TONE[b.x.tone] || a.n - b.n).map((y) => y.x).slice(0, 8);
}
