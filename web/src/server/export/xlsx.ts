import { zip, type ZipEntry } from "./xlsx-zip";
import { esc, isTextSheet, stylesXml, tableSheetXml, textSheetXml, type SheetSpec } from "./xlsx-xml";

export type { SheetSpec, TableSheet, TextSheet, TextLine, XlColumn, XlType } from "./xlsx-xml";
export { zip, unzip } from "./xlsx-zip";

/**
 * A dependency-free Excel (.xlsx, OOXML) writer.
 *
 *   const file: Buffer = buildXlsx({ sheets: [
 *     { name: "Drivers", rtl: false, freezeHeader: true,
 *       columns: [{ header: "Name", key: "name", type: "text" }, { header: "Earned (SAR)", key: "earnCents", type: "money" }, { header: "On time", key: "onTime", type: "percent" }],
 *       rows: [{ name: "Ali", earnCents: 123456, onTime: 0.923 }] },
 *     { name: "Notes", lines: [{ label: "Period", text: "2026-11-01 to 2026-11-20" }] },
 *   ] });
 *
 * Column types turn API base units into real Excel values: `money` halalas → SAR with 2 decimals, `percent` fraction → 0.0%, `duration` seconds → `[h]:mm:ss`, `km` metres → km with 1 decimal,
 * `date` / `datetime` ISO strings → Excel dates in Riyadh time. Text that starts with `= + - @` is stored as text with a leading apostrophe (as `toCsv` does). Sheet names are made valid and unique.
 */
export interface BuildOptions { sheets: SheetSpec[]; creator?: string; createdAt?: Date }

const BAD_NAME = /[\[\]:*?/\\\u0000-\u001f]/g;
/** Valid Excel sheet names: ≤ 31 UTF-16 units, none of `[]:*?/\`, no leading/trailing apostrophe, not empty, not "History", unique ignoring case. */
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>();
  return wanted.map((raw) => {
    const clip = (s: string, max: number) => { let out = ""; for (const ch of s) { if (out.length + ch.length > max) break; out += ch; } return out; };
    let base = clip(String(raw ?? "").replace(BAD_NAME, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, ""), 31).trim() || "Sheet";
    if (base.toLowerCase() === "history") base = "History_";
    let name = base, n = 1;
    while (used.has(name.toLowerCase())) { n++; const suffix = ` (${n})`; name = clip(base, 31 - suffix.length).trimEnd() + suffix; }
    used.add(name.toLowerCase());
    return name;
  });
}

const NS = "http://schemas.openxmlformats.org/";
export function buildXlsx(o: BuildOptions): Buffer {
  if (!o.sheets.length) throw new Error("A workbook needs at least one sheet");
  const names = sheetNames(o.sheets.map((s) => s.name));
  const at = o.createdAt ?? new Date();
  const files: ZipEntry[] = [];
  const add = (name: string, xml: string | Buffer) => files.push({ name, data: typeof xml === "string" ? Buffer.from(xml, "utf8") : xml });
  const defined: string[] = [];
  const sheetFiles = o.sheets.map((s, i) => {
    if (isTextSheet(s)) return textSheetXml(s, i === 0);
    const { xml, filterRef } = tableSheetXml(s, i === 0);
    if (filterRef) defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(`'${names[i].replace(/'/g, "''")}'!${filterRef.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`)}</definedName>`);
    return xml;
  });
  const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  add("[Content_Types].xml", head + `<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + o.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  add("_rels/.rels", head + `<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `<Relationship Id="rId2" Type="${NS}package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS}officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  add("docProps/core.xml", head + `<cp:coreProperties xmlns:cp="${NS}package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:creator>${esc(o.creator ?? "JR Logistics")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${at.toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`);
  add("docProps/app.xml", head + `<Properties xmlns="${NS}officeDocument/2006/extended-properties"><Application>JR Logistics</Application></Properties>`);
  add("xl/workbook.xml", head + `<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`
    + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets>`
    + (defined.length ? `<definedNames>${defined.join("")}</definedNames>` : "") + `</workbook>`);
  add("xl/_rels/workbook.xml.rels", head + `<Relationships xmlns="${NS}package/2006/relationships">`
    + o.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${o.sheets.length + 1}" Type="${NS}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add("xl/styles.xml", stylesXml());
  sheetFiles.forEach((xml, i) => add(`xl/worksheets/sheet${i + 1}.xml`, xml));
  return zip(files, at);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
