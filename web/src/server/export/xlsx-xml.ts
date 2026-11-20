/**
 * OOXML pieces of the workbook writer (`xlsx.ts` assembles them): value coercion by column type, styles, one worksheet's XML.
 * Cells are written as inline strings (no shared-string table to keep in memory) and as real numbers with number formats, so Excel sorts, sums and charts them.
 */
import { parseYmd } from "../analytics/time";

export type XlType = "text" | "int" | "number" | "money" | "percent" | "duration" | "date" | "datetime" | "km" | "dint" | "dnumber" | "dmoney" | "dpercent";

export interface XlColumn {
  header: string;
  key: string;
  /** `money`: integer halalas → SAR (2 decimals) · `percent`: fraction 0–1 · `duration`: seconds → `[h]:mm:ss` · `km`: metres → km (1 decimal) · `date`/`datetime`: ISO string or Date → Excel date in Riyadh time ·
   * `dint/dnumber/dmoney/dpercent`: signed change columns (`+12`, `-3.5%`). */
  type: XlType;
  /** Character width; estimated from the header and the first rows when missing. */
  width?: number;
  /** Row field that names the type of THIS cell (a Summary mixes counts, money and percentages in one column); falls back to `type`. */
  typeKey?: string;
}
export interface TableSheet {
  name: string;
  /** Right-to-left sheet view (Arabic, Urdu). */
  rtl?: boolean;
  columns: XlColumn[];
  rows: Array<Record<string, unknown>>;
  /** Default true. */
  freezeHeader?: boolean;
  /** Default true. */
  autoFilter?: boolean;
  /** Plain lines written under the table after one blank row. */
  notes?: string[];
}
export interface TextLine { label?: string; text?: string; style?: "title" | "heading" | "label" | "text" }
/** A sheet of labelled text lines (the Notes sheet): column A = label, column B = wrapped text. */
export interface TextSheet { name: string; rtl?: boolean; lines: TextLine[] }
export type SheetSpec = TableSheet | TextSheet;
export const isTextSheet = (s: SheetSpec): s is TextSheet => "lines" in s;

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
/** Characters XML 1.0 forbids (and lone surrogates) would make Excel call the file damaged. */
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const MAX_CELL_CHARS = 32_767;
/** Same rule as `toCsv` (a leading `= + - @`, tab or CR makes a spreadsheet read the cell as a formula) but also seen through leading spaces, as Thawani's export does. */
const FORMULA_LEAD = /^\s*[=+\-@]|^[\t\r]/;
/** Text of a cell without anything XML or Excel would reject (control characters, lone surrogates, more than 32 767 characters). Our own labels and headers use this. */
export function cleanText(v: unknown): string {
  const s = (v == null ? "" : typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : String(v)).replace(BAD_XML, "");
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS - 1) + "…" : s;
}
/** Text that came from data (names, notes …): `cleanText` plus the formula guard. */
export const safeText = (v: unknown): string => { const s = cleanText(v); return FORMULA_LEAD.test(s) ? "'" + s : s; };

const RIYADH_MS = 3 * 3_600_000, DAY_MS = 86_400_000, EPOCH_SERIAL = 25_569; // 1970-01-01 in Excel's 1900 date system
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Excel serial of an instant as Riyadh wall-clock time (the sheet shows what the Riyadh clock showed). `YYYY-MM-DD` is already a Riyadh day. */
export function dateSerial(v: unknown, withTime: boolean): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    if (YMD.test(v)) { const p = parseYmd(v); return p ? Date.UTC(p.y, p.m - 1, p.d) / DAY_MS + EPOCH_SERIAL : null; }
  }
  const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) return null;
  const local = t + RIYADH_MS;
  return (withTime ? local / DAY_MS : Math.floor(local / DAY_MS)) + EPOCH_SERIAL;
}
export function toNumber(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
/** The number stored in the cell for a typed value, or null when the value is not a number (then the cell falls back to text, so nothing is lost). */
export function cellNumber(type: XlType, v: unknown): number | null {
  switch (type) {
    case "date": return dateSerial(v, false);
    case "datetime": return dateSerial(v, true);
    case "text": return null;
    default: {
      const n = toNumber(v);
      if (n == null) return null;
      if (type === "money" || type === "dmoney") return r2(n / 100);
      if (type === "duration") return Number((n / 86_400).toPrecision(15)); // the 15 digits Excel itself keeps: 3600 s shows as 1:00:00, never 0:59:59
      if (type === "km") return n / 1000;
      return n;
    }
  }
}

// ---- styles ----------------------------------------------------------------------------------------------------------------------
const NUMFMT: Partial<Record<XlType, { id: number; code?: string }>> = {
  int: { id: 3 }, number: { id: 4 }, money: { id: 4 }, percent: { id: 168, code: "0.0%" }, duration: { id: 166, code: "[h]:mm:ss" }, date: { id: 164, code: "yyyy-mm-dd" },
  datetime: { id: 165, code: "yyyy-mm-dd hh:mm" }, km: { id: 167, code: "#,##0.0" }, dint: { id: 169, code: "+#,##0;-#,##0;0" }, dnumber: { id: 170, code: "+#,##0.00;-#,##0.00;0.00" },
  dmoney: { id: 170, code: "+#,##0.00;-#,##0.00;0.00" }, dpercent: { id: 171, code: "+0.0%;-0.0%;0.0%" },
};
type Struct = "header" | "title" | "heading" | "label" | "wrap";
const XF_TYPES: XlType[] = ["int", "number", "percent", "duration", "date", "datetime", "km", "dint", "dnumber", "dpercent"]; // money → number, dmoney → dnumber (same format)
const STRUCT: Struct[] = ["header", "title", "heading", "label", "wrap"];
const xfIndex = (t: XlType): number => { const f = t === "money" ? "number" : t === "dmoney" ? "dnumber" : t; const i = XF_TYPES.indexOf(f); return i < 0 ? 0 : 1 + i; };
const structIndex = (s: Struct) => 1 + XF_TYPES.length + STRUCT.indexOf(s);

export function stylesXml(): string {
  const codes = [...new Map(Object.values(NUMFMT).filter((x) => x?.code).map((x) => [x!.id, x!.code!])).entries()];
  const num = (id: number) => `numFmtId="${id}" applyNumberFormat="1"`;
  const xfs = [
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,
    ...XF_TYPES.map((t) => `<xf ${num(NUMFMT[t]!.id)} fontId="0" fillId="0" borderId="0" xfId="0"/>`),
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`,
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<numFmts count="${codes.length}">${codes.map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join("")}</numFmts>`
    + `<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font></fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill></fills>`
    + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

// ---- worksheets ------------------------------------------------------------------------------------------------------------------
export function colName(i: number): string { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`;
const textCell = (ref: string, s: number, text: string) => `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
const sheetView = (rtl: boolean | undefined, first: boolean, freeze: boolean) =>
  `<sheetViews><sheetView${rtl ? ` rightToLeft="1"` : ""}${first ? ` tabSelected="1"` : ""} workbookViewId="0">${freeze ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` : ""}</sheetView></sheetViews>`;

function typeOf(c: XlColumn, row: Record<string, unknown>): XlType {
  const t = c.typeKey ? row[c.typeKey] : undefined;
  return typeof t === "string" && (t === "text" || Object.hasOwn(NUMFMT, t)) ? (t as XlType) : c.type;
}
function cellXml(ref: string, c: XlColumn, row: Record<string, unknown>): string {
  const v = row[c.key];
  if (v == null || v === "") return "";
  const type = typeOf(c, row);
  const n = cellNumber(type, v);
  if (n != null) return `<c r="${ref}" s="${xfIndex(type)}"><v>${n}</v></c>`;
  return textCell(ref, 0, safeText(v));
}
const FMT_WIDTH: Record<XlType, number> = { text: 12, int: 8, number: 10, money: 14, percent: 8, duration: 10, date: 11, datetime: 17, km: 9, dint: 9, dnumber: 11, dmoney: 12, dpercent: 9 };
function widthOf(c: XlColumn, rows: Array<Record<string, unknown>>): number {
  if (c.width) return Math.min(Math.max(c.width, 4), 120);
  let w = Math.min(c.header.length * 1.15 + 2, 30);
  for (let i = 0; i < Math.min(rows.length, 300); i++) {
    const v = rows[i][c.key];
    if (v == null || v === "") continue;
    const t = typeOf(c, rows[i]);
    w = Math.max(w, t === "text" ? Math.min(String(v).length * 1.1 + 2, 60) : FMT_WIDTH[t]);
  }
  return Math.round(Math.max(w, 8) * 10) / 10;
}

/** One worksheet. The rows are turned into bytes in slabs of 1 000 so a 50 000-row sheet never exists as one giant string next to its buffer. */
export function tableSheetXml(s: TableSheet, first: boolean): { xml: Buffer; filterRef: string | null } {
  const cols = s.columns, last = Math.max(cols.length - 1, 0), lastCol = colName(last);
  const freeze = s.freezeHeader !== false && cols.length > 0;
  const slabs: Buffer[] = [];
  let parts: string[] = [];
  const flush = () => { if (parts.length) { slabs.push(Buffer.from(parts.join(""), "utf8")); parts = []; } };
  const header = cols.map((c, i) => textCell(`${colName(i)}1`, structIndex("header"), cleanText(c.header))).join("");
  parts.push(`<row r="1">${header}</row>`);
  let r = 1;
  for (const row of s.rows) {
    r++;
    let cells = "";
    for (let i = 0; i < cols.length; i++) cells += cellXml(`${colName(i)}${r}`, cols[i], row);
    parts.push(`<row r="${r}">${cells}</row>`);
    if (parts.length >= 1000) flush();
  }
  const tableEnd = r;
  if (s.notes?.length) { r++; for (const line of s.notes) { r++; parts.push(`<row r="${r}">${textCell(`A${r}`, 0, safeText(line))}</row>`); } }
  flush();
  const filterRef = s.autoFilter !== false && cols.length ? `A1:${lastCol}${tableEnd}` : null;
  const head = XML_HEAD + `<dimension ref="A1:${lastCol}${r}"/>` + sheetView(s.rtl, first, freeze) + `<sheetFormatPr defaultRowHeight="15"/>`
    + (cols.length ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c, s.rows)}" customWidth="1"/>`).join("")}</cols>` : "") + `<sheetData>`;
  const tail = `</sheetData>` + (filterRef ? `<autoFilter ref="${filterRef}"/>` : "") + `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  return { xml: Buffer.concat([Buffer.from(head, "utf8"), ...slabs, Buffer.from(tail, "utf8")]), filterRef };
}

export function textSheetXml(s: TextSheet, first: boolean): string {
  const rows = s.lines.map((l, i) => {
    const r = i + 1, st = l.style ?? (l.label ? "label" : "text");
    const a = l.label ? textCell(`A${r}`, structIndex(st === "title" ? "title" : st === "heading" ? "heading" : "label"), cleanText(l.label)) : "";
    const b = l.text ? textCell(`B${r}`, structIndex(st === "title" || st === "heading" ? "heading" : "wrap"), safeText(l.text)) : "";
    return `<row r="${r}">${a}${b}</row>`;
  });
  return XML_HEAD + `<dimension ref="A1:B${Math.max(rows.length, 1)}"/>` + sheetView(s.rtl, first, false) + `<sheetFormatPr defaultRowHeight="15"/>`
    + `<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData>`
    + `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}
