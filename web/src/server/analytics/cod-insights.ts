import { MIN_VOLUME } from "./finance-core";
import type { Insight } from "./insights";
import type { Kpi } from "./kpi";
import type { Alert, Holder } from "./cod-live";

const pct1 = (n: number) => Math.round(n * 1000) / 10;
const DAY = 86_400;

export interface CodInsightInput { kpis: Kpi[]; money: boolean; drivers: Holder[]; alerts: Alert[]; outstanding: number; collected: number }

/** Plain-language observations of the COD report (pure, unit-tested). Amount-based observations exist only for viewers with `finance.view`. */
export function codInsights(i: CodInsightInput): Insight[] {
  const out: Insight[] = [];
  const v = (key: string) => i.kpis.find((k) => k.key === key)?.value ?? null;
  const parcels = v("cod_parcels") ?? 0;
  if (parcels < MIN_VOLUME) out.push({ key: "rpd.ins_cod_sparse", tone: "info", vars: { n: parcels } });
  const aged = v("cod_aged_orders") ?? 0;
  if (aged > 0) out.push({ key: "rpd.ins_cod_aged", tone: "bad", vars: { n: aged }, href: "/admin/finance/cod" });
  const mismatch = v("cod_mismatch") ?? 0;
  if (mismatch > 0) out.push({ key: "rpd.ins_cod_mismatch", tone: "bad", vars: { n: mismatch } });
  const p90 = v("cod_lag_p90");
  if (p90 != null && p90 > 3 * DAY) out.push({ key: "rpd.ins_cod_lag", tone: "bad", vars: { n: Math.round((p90 / DAY) * 10) / 10 } });
  if (!i.money) return out.slice(0, 6);
  const rate = v("cod_remit_rate"), collected = v("cod_collected") ?? 0;
  if (rate != null && collected > 0 && rate < 0.7) out.push({ key: "rpd.ins_cod_remit_low", tone: "bad", vars: { n: pct1(rate) } });
  const top = i.drivers[0];
  if (top && i.outstanding > 0 && top.outstanding / i.outstanding >= 0.3 && i.drivers.length > 1) out.push({ key: "rpd.ins_cod_holder", tone: "info", vars: { name: top.name ?? top.key, n: pct1(top.outstanding / i.outstanding) }, href: `/admin/drivers/${top.key}` });
  return out.slice(0, 6);
}
