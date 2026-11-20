import { unzip } from "@/server/export/xlsx-zip";

/** A tiny .xlsx reader for tests (no dependency): the sheets of a workbook as grids of values with their number formats. */
export interface ReadCell { v: string | number; fmt: string; text: boolean }
export interface ReadSheet {
  name: string; rtl: boolean; frozen: boolean; autoFilter: string | null; widths: number[];
  /** Row-major values (`null` for an empty cell); row 0 is the header row. */
  rows: Array<Array<string | number | null>>;
  cells: Map<string, ReadCell>;
}
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function readXlsx(buf: Buffer): ReadSheet[] {
  const files = unzip(buf);
  const text = (name: string) => { const f = files.get(name); if (!f) throw new Error(`missing ${name}`); return f.toString("utf8"); };
  const styles = text("xl/styles.xml");
  const custom = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unesc(m[2])]));
  const builtin: Record<number, string> = { 0: "General", 3: "#,##0", 4: "#,##0.00" };
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)?.[1] ?? "").matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  const fmtOf = (s: number) => { const id = xfs[s] ?? 0; return custom.get(id) ?? builtin[id] ?? `#${id}`; };
  const wb = text("xl/workbook.xml");
  const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => unesc(m[1]));
  return names.map((name, i) => {
    const xml = text(`xl/worksheets/sheet${i + 1}.xml`);
    const cells = new Map<string, ReadCell>();
    const rows: ReadSheet["rows"] = [];
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(.*?)<\/c>/gs)) {
      const [, col, row, s, t, inner] = m;
      let v: string | number;
      if (t === "inlineStr") v = unesc(/<t[^>]*>(.*?)<\/t>/s.exec(inner)?.[1] ?? ""); else v = Number(/<v>(.*?)<\/v>/s.exec(inner)?.[1]);
      cells.set(`${col}${row}`, { v, fmt: fmtOf(Number(s ?? 0)), text: t === "inlineStr" });
      (rows[Number(row) - 1] ??= [])[colIndex(col)] = v;
    }
    for (let r = 0; r < rows.length; r++) { rows[r] ??= []; for (let c = 0; c < rows[r].length; c++) rows[r][c] ??= null; }
    return {
      name, cells, rows: Array.from(rows, (r) => r ?? []), rtl: /<sheetView[^>]*rightToLeft="1"/.test(xml), frozen: /<pane [^>]*state="frozen"/.test(xml),
      autoFilter: /<autoFilter ref="([^"]+)"/.exec(xml)?.[1] ?? null, widths: [...xml.matchAll(/<col [^>]*width="([\d.]+)"/g)].map((x) => Number(x[1])),
    };
  });
}
export const sheetOf = (sheets: ReadSheet[], name: string) => { const s = sheets.find((x) => x.name === name); if (!s) throw new Error(`no sheet ${name} in ${sheets.map((x) => x.name).join(", ")}`); return s; };
