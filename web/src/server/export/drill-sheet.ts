import type { DrillColumn } from "../analytics/registry";
import type { Tr } from "./context";
import type { TableSheet, XlColumn, XlType } from "./xlsx";

type Row = Record<string, unknown>;
/** Distances are metres in the API; the column key says so (`radiusM`, `routeM`, `gpsM` …). A column can also say it with `xl: "km"`. */
const METRES = /(?:radius|route|gps|distance|leg|trip)M$/i;
/** A label that names metres (`Radius distance (m)`, `(م)`, `(میٹر)`): the export shows kilometres, so that unit is swapped, not repeated. */
const METRE_UNIT = /\s*[(（](?:m|م|میٹر)[)）]\s*$/;
const DRILL_TYPES: Partial<Record<string, XlType>> = { money: "money", percent: "percent", duration: "duration", distance: "km", date: "date", datetime: "datetime" };

/** The Excel type of a drill column: its declared `xl` hint, else from `type` (and `number` columns that only hold whole numbers become `int`). */
export function drillType(c: DrillColumn, rows: Row[]): XlType {
  if (c.xl) return c.xl;
  const t = DRILL_TYPES[c.type ?? "text"];
  if (t) return t;
  if (c.type === "number") {
    if (METRES.test(c.key)) return "km";
    if (/Cents$/.test(c.key)) return "money";
    for (const r of rows) { const v = r[c.key]; if (v != null && v !== "" && !Number.isInteger(Number(v))) return "number"; }
    return "int";
  }
  return "text";
}

/** One drill-down table as a worksheet: localized headers (money and km columns say their unit), enum/status values translated, real number formats. */
export function drillSheet(tr: Tr, o: { name: string; columns: DrillColumn[]; rows: Row[]; cityName?: (key: string) => string | undefined }): TableSheet {
  const translated = o.columns.filter((c) => (c.type === "enum" || c.type === "status") && c.ns);
  const word = (c: DrillColumn, v: unknown) => {
    if (v == null || v === "") return v;
    const k = `${c.ns}.${v}`;
    if (tr.has(k)) return tr(k);
    return c.ns === "city" ? (o.cityName?.(String(v)) ?? v) : v;
  };
  const rows = translated.length ? o.rows.map((r) => { const x: Row = { ...r }; for (const c of translated) if (c.key in x) x[c.key] = word(c, x[c.key]); return x; }) : o.rows;
  const columns: XlColumn[] = o.columns.map((c) => {
    const type = drillType(c, o.rows);
    const label = type === "km" ? tr(c.label).replace(METRE_UNIT, "") : tr(c.label), unit = type === "money" ? tr("fr.xl_sar") : type === "km" ? tr("fr.xl_km") : "";
    return { header: unit && !label.includes(`(${unit})`) ? `${label} (${unit})` : label, key: c.key, type }; // a label that already names its unit keeps it as it is
  });
  return { name: o.name, rtl: tr.rtl, columns, rows, freezeHeader: true };
}

/** The Excel types a column set uses (decides which generic "how to read this" lines apply). */
export const typesOf = (columns: DrillColumn[], rows: Row[] = []): Set<XlType> => new Set(columns.map((c) => drillType(c, rows)));
