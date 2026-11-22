import type { DrillColumn } from "../analytics/registry";
import { getSettings } from "../settings";
import { csvLine, toCsv } from "../ops";
import type { Tr } from "./context";
import { drillSheet } from "./drill-sheet";
import type { XlType } from "./xlsx";
import { dateSerial, toNumber } from "./xlsx-xml";

type Row = Record<string, unknown>;
const RIYADH_MS = 3 * 3_600_000;

/** `2026-11-20` or `2026-11-20 14:05` on the Riyadh clock (a plain `YYYY-MM-DD` is already a Riyadh day). */
function riyadhText(v: unknown, withTime: boolean): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t) || dateSerial(v, withTime) == null) return v == null ? "" : String(v);
  return new Date(t + RIYADH_MS).toISOString().slice(0, withTime ? 16 : 10).replace("T", " ");
}
const hms = (sec: number) => { const s = Math.round(sec); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** One cell the way a person reads it: money in riyals, percentages as 0–100, distances in km, durations as h:mm:ss, dates on the Riyadh clock. Anything that is not a number stays as it is. */
export function csvValue(type: XlType, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return "";
  if (type === "date" || type === "datetime") return riyadhText(v, type === "datetime");
  if (type === "text") return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  const n = toNumber(v);
  if (n == null) return v;
  switch (type) {
    case "money": case "dmoney": return (n / 100).toFixed(2);
    case "percent": case "dpercent": return String(Math.round(n * 1000) / 10);
    case "km": return (n / 1000).toFixed(1);
    case "duration": return hms(n);
    default: return n;
  }
}

/** The unit a header of this type must say (money and km are already in the localized label of the sheet header). */
const UNIT: Partial<Record<XlType, string>> = { percent: "%", dpercent: "%", duration: "h:mm:ss" };

/**
 * The CSV of a drill-down table for people: the same localized headers as the Excel export (label + unit — `Withdrawals requested (SAR)`, not `wdRequestedCents`),
 * enum / status values in words, money in riyals instead of halalas. `headers=keys` on the endpoints keeps the raw keys and values for machines (see `rawCsv`).
 */
export function drillCsv(tr: Tr, o: { columns: DrillColumn[]; rows: Row[]; cityName?: (key: string) => string | undefined }): string {
  const sheet = drillSheet(tr, { name: "csv", columns: o.columns, rows: o.rows, cityName: o.cityName });
  const seen = new Map<string, number>();
  const headers = sheet.columns.map((c) => {
    const unit = UNIT[c.type];
    let h = unit && !c.header.includes(`(${unit})`) && !(unit === "%" && c.header.includes("%")) ? `${c.header} (${unit})` : c.header;
    const n = (seen.get(h) ?? 0) + 1; seen.set(h, n);
    if (n > 1) h = `${h} [${c.key}]`; // two columns with the same label stay tellable apart
    return h;
  });
  return [csvLine(headers), ...sheet.rows.map((r) => csvLine(sheet.columns.map((c) => csvValue(c.type, r[c.key]))))].join("\n");
}

/** `drillCsv` with the city names of the platform settings in the viewer's language (what `tableXlsx` does for Excel). */
export async function tableCsv(tr: Tr, columns: DrillColumn[], rows: Row[]): Promise<string> {
  const cities = new Map((await getSettings()).cities.map((c) => [c.key, c[tr.locale] || c.en]));
  return drillCsv(tr, { columns, rows, cityName: (k) => cities.get(k) });
}

/** The raw machine form (`headers=keys`): the column keys as headers and the values exactly as the API returns them (money in halalas). */
export function rawCsv(columns: Array<{ key: string }>, rows: Row[]): string {
  const cell = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
  return toCsv(columns.map((c) => c.key), rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]))));
}
