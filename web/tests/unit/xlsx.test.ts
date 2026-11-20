/**
 * The dependency-free .xlsx writer (`server/export/xlsx*.ts`): zip container, sheet names, value coercion, formula safety, Arabic text, styles, big sheets — and, when python3 + openpyxl are
 * installed, a round trip through a real spreadsheet library (the same file Excel would open).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { buildXlsx, sheetNames, type SheetSpec, type TableSheet } from "@/server/export/xlsx";
import { cellNumber, dateSerial, safeText, MAX_CELL_CHARS } from "@/server/export/xlsx-xml";
import { crc32, unzip, zip } from "@/server/export/xlsx-zip";
import { drillSheet, typesOf } from "@/server/export/drill-sheet";
import { translator } from "@/server/export/context";
import type { DrillColumn } from "@/server/analytics/registry";
import { readXlsx } from "../helpers/xlsx-read";

const SERIAL_1970 = 25569;
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000 + SERIAL_1970;

describe("zip container", () => {
  it("computes the same CRC-32 as zlib and round-trips entries (compressed, stored, empty, unicode names)", () => {
    const big = Buffer.from("x".repeat(100_000)), tiny = Buffer.from("ab"), empty = Buffer.alloc(0), arabic = Buffer.from("مرحبا", "utf8");
    expect(crc32(tiny)).toBe(zlib.crc32(tiny));
    const out = unzip(zip([{ name: "a/big.txt", data: big }, { name: "tiny", data: tiny }, { name: "empty", data: empty }, { name: "مرحبا.txt", data: arabic }]));
    expect([...out.keys()]).toEqual(["a/big.txt", "tiny", "empty", "مرحبا.txt"]);
    expect(out.get("a/big.txt")!.equals(big)).toBe(true); expect(out.get("tiny")!.toString()).toBe("ab"); expect(out.get("empty")!.length).toBe(0); expect(out.get("مرحبا.txt")!.toString()).toBe("مرحبا");
  });
  it("refuses garbage and detects a corrupted entry", () => {
    expect(() => unzip(Buffer.from("not a zip"))).toThrow();
    const z = zip([{ name: "a", data: Buffer.from("hello hello hello hello") }]);
    z[40] ^= 0xff; // flip a byte of the compressed data
    expect(() => unzip(z)).toThrow();
  });
});

describe("sheet names", () => {
  it("removes the characters Excel forbids, trims apostrophes and caps at 31 characters", () => {
    expect(sheetNames(["Drivers: Q1/[x]?*\\"])).toEqual(["Drivers Q1 x"]);
    expect(sheetNames(["'quoted'"])).toEqual(["quoted"]);
    expect(sheetNames(["A".repeat(50)])[0]).toHaveLength(31);
    expect(sheetNames([""])).toEqual(["Sheet"]); expect(sheetNames(["  "])).toEqual(["Sheet"]); expect(sheetNames(["[]:*?/\\"])).toEqual(["Sheet"]);
    expect(sheetNames(["History"])).toEqual(["History_"]);
  });
  it("never splits a surrogate pair at the limit and counts UTF-16 units", () => {
    const n = sheetNames(["ا".repeat(30) + "😀😀"])[0];
    expect(n.length).toBeLessThanOrEqual(31); expect([...n].every((ch) => ch !== "�")).toBe(true); expect(n.endsWith("😀")).toBe(false);
  });
  it("makes names unique ignoring case, still within 31 characters", () => {
    expect(sheetNames(["Data", "data", "DATA"])).toEqual(["Data", "data (2)", "DATA (3)"]);
    const long = sheetNames(["B".repeat(40), "B".repeat(40)]);
    expect(long[0]).toHaveLength(31); expect(long[1]).toHaveLength(31); expect(long[1].endsWith(" (2)")).toBe(true); expect(new Set(long.map((x) => x.toLowerCase())).size).toBe(2);
  });
});

describe("value coercion", () => {
  it("money is halalas to SAR, rounded to 2 decimals; km is metres; percent stays a fraction; duration is a fraction of a day", () => {
    expect(cellNumber("money", 12345)).toBe(123.45); expect(cellNumber("money", "250")).toBe(2.5); expect(cellNumber("money", 1)).toBe(0.01); expect(cellNumber("money", -50)).toBe(-0.5);
    expect(cellNumber("dmoney", 5000)).toBe(50);
    expect(cellNumber("km", 1500)).toBe(1.5); expect(cellNumber("percent", 0.923)).toBe(0.923); expect(cellNumber("int", "7")).toBe(7);
    expect(cellNumber("duration", 3600)).toBeCloseTo(1 / 24, 12); expect(cellNumber("duration", 86_400 * 2)).toBe(2);
  });
  it("a value that is not a number never becomes 0 (it becomes null, so the cell falls back to text)", () => {
    for (const v of [null, undefined, "", "n/a", NaN, Infinity, true]) expect(cellNumber("number", v)).toBeNull();
    expect(cellNumber("money", "abc")).toBeNull();
  });
  it("dates are Excel serials in Riyadh time: a day string is already a Riyadh day, an instant is shifted by +3 h", () => {
    expect(dateSerial("2026-11-19", false)).toBe(day(2026, 11, 19));
    expect(dateSerial("2026-11-19T20:59:59.000Z", false)).toBe(day(2026, 11, 19)); // 23:59:59 Riyadh
    expect(dateSerial("2026-11-19T21:00:00.000Z", false)).toBe(day(2026, 11, 20)); // 00:00 Riyadh next day
    expect(dateSerial("2026-11-19T21:30:00.000Z", true)).toBeCloseTo(day(2026, 11, 20) + 30 / 1440, 9);
    expect(dateSerial(new Date("2026-11-19T09:00:00Z"), true)).toBeCloseTo(day(2026, 11, 19) + 12 / 24, 9);
    expect(dateSerial("garbage", false)).toBeNull(); expect(dateSerial(null, true)).toBeNull(); expect(dateSerial("2026-13-45", false)).toBeNull();
  });
});

describe("text safety", () => {
  it("prefixes anything a spreadsheet could read as a formula, the way toCsv does (also behind spaces)", () => {
    for (const v of ["=1+1", "+966500000000", "-5", "@SUM(A1)", "\t=x", "\r=x", "  =HYPERLINK(\"http://evil\")"]) expect(safeText(v), v).toBe("'" + v);
    for (const v of ["plain", "a=b", "مرحبا", "5-3", "", "12"]) expect(safeText(v), v).toBe(v);
  });
  it("removes characters XML forbids, keeps Arabic/Urdu/emoji, and caps a cell at 32 767 characters", () => {
    expect(safeText("a\u0000b\u0008c\u001fd￾e")).toBe("abcde");
    expect(safeText("ok\uD800broken")).toBe("okbroken");
    expect(safeText("مرحبا بالعالم · اردو 😀")).toBe("مرحبا بالعالم · اردو 😀");
    expect(safeText("x".repeat(40_000))).toHaveLength(MAX_CELL_CHARS);
    expect(safeText({ a: 1 })).toBe('{"a":1}');
  });
});

const sample = (): SheetSpec[] => [
  {
    name: "Drivers & <Co>", rtl: true,
    columns: [
      { header: "الاسم", key: "name", type: "text" }, { header: "Earned (SAR)", key: "earn", type: "money" }, { header: "On time", key: "pct", type: "percent" }, { header: "Online", key: "dur", type: "duration" },
      { header: "Distance (km)", key: "km", type: "km" }, { header: "Day", key: "day", type: "date" }, { header: "At", key: "at", type: "datetime" }, { header: "Jobs", key: "n", type: "int" }, { header: "Avg", key: "avg", type: "number" },
    ],
    rows: [
      { name: "=HYPERLINK(\"http://evil\")", earn: 123456, pct: 0.923, dur: 3661, km: 12_345, day: "2026-11-19", at: "2026-11-19T21:30:00.000Z", n: 1234, avg: 4.256 },
      { name: "سائق عربي · اردو نام", earn: -5000, pct: 0, dur: 0, km: 0, day: null, at: "bad", n: 0, avg: null },
      { name: "A & B <tag> \"q\"", earn: null, pct: null, dur: null, km: null, day: "2026-01-01", at: null, n: null, avg: 1 },
    ],
  },
  { name: "Notes", lines: [{ label: "Title", style: "title" }, { label: "Period", text: "2026-11-01 to 2026-11-20" }, { text: "=not a formula" }] },
];

describe("workbook XML", () => {
  it("writes the package parts, the sheet names, the right-to-left view and the frozen, filtered header", () => {
    const files = unzip(buildXlsx({ sheets: sample() }));
    expect([...files.keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "docProps/core.xml"]));
    const sheets = readXlsx(buildXlsx({ sheets: sample() }));
    expect(sheets.map((s) => s.name)).toEqual(["Drivers & <Co>", "Notes"]);
    const [d, n] = sheets;
    expect(d.rtl).toBe(true); expect(d.frozen).toBe(true); expect(d.autoFilter).toBe("A1:I4"); expect(n.rtl).toBe(false); expect(n.frozen).toBe(false);
    expect(d.rows[0]).toEqual(["الاسم", "Earned (SAR)", "On time", "Online", "Distance (km)", "Day", "At", "Jobs", "Avg"]);
    expect(d.widths).toHaveLength(9); expect(d.widths.every((w) => w >= 8 && w <= 120)).toBe(true);
  });
  it("applies a real number format per column type and converts the values", () => {
    const [d] = readXlsx(buildXlsx({ sheets: sample() }));
    const f = (ref: string) => d.cells.get(ref)!;
    expect(f("B2")).toMatchObject({ v: 1234.56, fmt: "#,##0.00" }); expect(f("B3").v).toBe(-50);
    expect(f("C2")).toMatchObject({ v: 0.923, fmt: "0.0%" });
    expect(f("D2")).toMatchObject({ fmt: "[h]:mm:ss" }); expect(Number(f("D2").v) * 86_400).toBeCloseTo(3661, 3);
    expect(f("E2")).toMatchObject({ v: 12.345, fmt: "#,##0.0" });
    expect(f("F2")).toMatchObject({ v: day(2026, 11, 19), fmt: "yyyy-mm-dd" });
    expect(f("G2")).toMatchObject({ fmt: "yyyy-mm-dd hh:mm" }); expect(Number(f("G2").v)).toBeCloseTo(day(2026, 11, 20) + 30 / 1440, 9);
    expect(f("H2")).toMatchObject({ v: 1234, fmt: "#,##0" }); expect(f("I2")).toMatchObject({ v: 4.256, fmt: "#,##0.00" });
  });
  it("leaves empty values empty (never 0) and keeps unparseable values as text instead of losing them", () => {
    const [d] = readXlsx(buildXlsx({ sheets: sample() }));
    expect(d.cells.has("F3")).toBe(false); expect(d.cells.has("B4")).toBe(false); expect(d.cells.has("I3")).toBe(false);
    expect(d.cells.get("G3")).toMatchObject({ v: "bad", text: true });
  });
  it("stores formula-looking text as text with the guard apostrophe, escapes XML, and keeps Arabic, Urdu and quotes intact", () => {
    const [d, n] = readXlsx(buildXlsx({ sheets: sample() }));
    expect(d.cells.get("A2")).toMatchObject({ v: "'=HYPERLINK(\"http://evil\")", text: true });
    expect(d.cells.get("A3")!.v).toBe("سائق عربي · اردو نام"); expect(d.cells.get("A4")!.v).toBe("A & B <tag> \"q\"");
    expect(n.cells.get("B2")!.v).toBe("2026-11-01 to 2026-11-20"); expect(n.cells.get("B3")!.v).toBe("'=not a formula");
    const xml = unzip(buildXlsx({ sheets: sample() })).get("xl/worksheets/sheet1.xml")!.toString();
    expect(xml).not.toMatch(/<f>/); expect(xml).toContain("&amp; B &lt;tag&gt; &quot;q&quot;");
  });
  it("signed change types show an explicit sign, and a per-cell type overrides the column type (a Summary mixes counts, money and percentages)", () => {
    const [s] = readXlsx(buildXlsx({ sheets: [{
      name: "Summary", columns: [{ header: "K", key: "k", type: "text" }, { header: "Now", key: "v", type: "number", typeKey: "u" }, { header: "Chg", key: "d", type: "dnumber", typeKey: "du" }],
      rows: [{ k: "orders", v: 10, u: "int", d: 3, du: "dint" }, { k: "revenue", v: 250_000, u: "money", d: -5000, du: "dmoney" }, { k: "rate", v: 0.5, u: "percent", d: 0.05, du: "dpercent" }],
    }] }));
    expect(s.cells.get("B2")!.fmt).toBe("#,##0"); expect(s.cells.get("B3")).toMatchObject({ v: 2500, fmt: "#,##0.00" }); expect(s.cells.get("B4")!.fmt).toBe("0.0%");
    expect(s.cells.get("C2")!.fmt).toBe("+#,##0;-#,##0;0"); expect(s.cells.get("C3")).toMatchObject({ v: -50, fmt: "+#,##0.00;-#,##0.00;0.00" }); expect(s.cells.get("C4")!.fmt).toBe("+0.0%;-0.0%;0.0%");
  });
  it("handles an empty table, header-only sheets, notes under a table, duplicate sheet names, and refuses a workbook without sheets", () => {
    const sheets = readXlsx(buildXlsx({ sheets: [
      { name: "Empty", columns: [{ header: "A", key: "a", type: "text" }], rows: [], notes: ["line one", "=line two"] }, { name: "empty", columns: [{ header: "A", key: "a", type: "text" }], rows: [], freezeHeader: false, autoFilter: false },
    ] }));
    expect(sheets.map((s) => s.name)).toEqual(["Empty", "empty (2)"]);
    expect(sheets[0].autoFilter).toBe("A1:A1"); expect(sheets[0].rows[2][0]).toBe("line one"); expect(sheets[0].rows[3][0]).toBe("'=line two");
    expect(sheets[1].frozen).toBe(false); expect(sheets[1].autoFilter).toBeNull();
    expect(() => buildXlsx({ sheets: [] })).toThrow();
  });
  it("writes 6 000 rows x 9 columns quickly into a valid, compressed file", () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({ name: `Driver ${i} مرحبا`, earn: i * 100, pct: (i % 100) / 100, dur: i * 60, km: i * 1000, day: "2026-11-19", at: "2026-11-19T10:00:00Z", n: i, avg: i / 7 }));
    const t = Date.now();
    const file = buildXlsx({ sheets: [{ ...(sample()[0] as TableSheet), name: "Big", rows }] });
    expect(Date.now() - t).toBeLessThan(5000);
    const [big] = readXlsx(file);
    expect(big.rows).toHaveLength(6001); expect(big.rows[6000][0]).toBe("Driver 5999 مرحبا"); expect(big.autoFilter).toBe("A1:I6001");
    expect(file.length).toBeLessThan(rows.length * 9 * 40); // far smaller than the raw XML
  });
});

/** python3 + openpyxl: the file opens in a real spreadsheet library and shows what we wrote. */
const PY = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
out = {"names": wb.sheetnames, "sheets": {}}
for ws in wb.worksheets:
    cells = {}
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 4)):
        for c in row:
            if c.value is not None: cells[c.coordinate] = [str(c.value), c.number_format, c.data_type]
    out["sheets"][ws.title] = {"rtl": bool(ws.sheet_view.rightToLeft), "freeze": ws.freeze_panes, "filter": ws.auto_filter.ref, "rows": ws.max_row, "cols": ws.max_column, "cells": cells, "last": ws.cell(row=ws.max_row, column=1).value}
print(json.dumps(out, ensure_ascii=False))
`;
const hasOpenpyxl = (() => { try { execFileSync("python3", ["-I", "-c", "import openpyxl"], { stdio: "ignore" }); return true; } catch { return false; } })();
describe.skipIf(!hasOpenpyxl)("opens in openpyxl", () => {
  const open = (buf: Buffer) => {
    const dir = mkdtempSync(join(tmpdir(), "xlsx-test-"));
    try { const f = join(dir, "t.xlsx"); writeFileSync(f, buf); return JSON.parse(execFileSync("python3", ["-I", "-c", PY, f], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  };
  it("sheet names, headers, number formats, frozen pane, RTL flag, formula-safe text and Arabic round trip", () => {
    const r = open(buildXlsx({ sheets: sample() }));
    expect(r.names).toEqual(["Drivers & <Co>", "Notes"]);
    const d = r.sheets["Drivers & <Co>"];
    expect(d).toMatchObject({ rtl: true, freeze: "A2", filter: "A1:I4", rows: 4, cols: 9 });
    expect(d.cells.A1[0]).toBe("الاسم"); expect(d.cells.B1[0]).toBe("Earned (SAR)");
    expect(d.cells.A2).toEqual(["'=HYPERLINK(\"http://evil\")", "General", "s"]); // text, not a formula ("f")
    expect(d.cells.A3[0]).toBe("سائق عربي · اردو نام");
    expect(d.cells.B2).toEqual(["1234.56", "#,##0.00", "n"]); expect(d.cells.C2).toEqual(["0.923", "0.0%", "n"]);
    expect(d.cells.D2[1]).toBe("[h]:mm:ss"); expect(d.cells.D2[0]).toBe("1:01:01"); // 3661 s
    expect(d.cells.E2).toEqual(["12.345", "#,##0.0", "n"]); expect(d.cells.F2[0]).toBe("2026-11-19 00:00:00"); expect(d.cells.G2[0]).toBe("2026-11-20 00:30:00");
    expect(d.cells.H2).toEqual(["1234", "#,##0", "n"]);
    expect(r.sheets.Notes).toMatchObject({ rtl: false, freeze: null });
  });
  it("a 6 000-row sheet is still valid", () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({ name: `Row ${i} ${i % 2 ? "مرحبا" : "ok"}`, earn: i, pct: 0.5, dur: 60, km: 1000, day: "2026-11-19", at: "2026-11-19T10:00:00Z", n: i, avg: 1.5 }));
    const r = open(buildXlsx({ sheets: [{ ...(sample()[0] as TableSheet), name: "Big", rows }] }));
    expect(r.sheets.Big).toMatchObject({ rows: 6001, cols: 9, filter: "A1:I6001", freeze: "A2", rtl: true, last: "Row 5999 مرحبا" });
  });
});

describe("drill table to sheet", () => {
  const tr = translator("en"), ar = translator("ar");
  const cols: DrillColumn[] = [
    { key: "name", label: "rpp.col_driver", type: "link", href: "/x/{id}" }, { key: "city", label: "rpp.col_city", type: "enum", ns: "city" }, { key: "agreement", label: "rpp.col_agreement", type: "enum", ns: "rpp.agr" },
    { key: "jobs", label: "rpp.col_jobs", type: "number" }, { key: "rating", label: "rpp.col_rating", type: "number" }, { key: "earnCents", label: "rpp.col_earned", type: "money" },
    { key: "radiusM", label: "fr.col_radius_m", type: "number" }, { key: "distance", label: "rpp.col_jobs", type: "number", xl: "km" }, { key: "success", label: "rpp.col_success", type: "percent" }, { key: "online", label: "rpp.col_online", type: "duration" },
  ];
  const rows = [{ name: "Ali", city: "riyadh", agreement: "accepted", jobs: 3, rating: 4.5, earnCents: 1050, radiusM: 2500, distance: 100, success: 0.5, online: 60 }, { name: "Omar", city: "custom_town", agreement: "weird", jobs: 0, rating: null, earnCents: 0, radiusM: 0, distance: 0, success: null, online: 0 }];
  it("derives the Excel type of every column, with the unit in the header", () => {
    const s = drillSheet(tr, { name: "T", columns: cols, rows });
    expect(s.columns.map((c) => c.type)).toEqual(["text", "text", "text", "int", "number", "money", "km", "km", "percent", "duration"]);
    expect(s.columns[5].header).toBe("Earned (SAR)"); expect(s.columns[6].header).toBe("Radius distance (km)"); // "(m)" of the label is swapped for km, not repeated
    expect(s.columns[3].header).toBe("Jobs"); expect(s.rtl).toBe(false); expect(s.freezeHeader).toBe(true);
    expect(drillSheet(ar, { name: "T", columns: cols, rows }).columns[5].header).toBe("المستحق (ر.س)"); expect(drillSheet(ar, { name: "T", columns: cols, rows }).rtl).toBe(true);
    expect(drillSheet(tr, { name: "T", columns: cols, rows: [{ ...rows[0], jobs: 2.5 }] }).columns[3].type).toBe("number"); // one fractional value makes the whole column decimal
    expect(typesOf(cols, rows)).toEqual(new Set(["text", "int", "number", "money", "km", "percent", "duration"]));
  });
  it("translates enum values (city names from settings when the dictionary lacks them) and leaves unknown values as they are", () => {
    const s = drillSheet(tr, { name: "T", columns: cols, rows, cityName: (k) => (k === "custom_town" ? "Custom Town" : undefined) });
    expect(s.rows[0]).toMatchObject({ city: "Riyadh", agreement: tr("rpp.agr.accepted") }); expect(s.rows[1]).toMatchObject({ city: "Custom Town", agreement: "weird" });
    expect(rows[0].city).toBe("riyadh"); // the input rows are not mutated
  });
  it("a whole export builds with the right cell types (end to end through buildXlsx)", () => {
    const [d] = readXlsx(buildXlsx({ sheets: [drillSheet(tr, { name: "T", columns: cols, rows })] }));
    expect(d.rows[1].slice(0, 9)).toEqual(["Ali", "Riyadh", tr("rpp.agr.accepted"), 3, 4.5, 10.5, 2.5, 0.1, 0.5]); expect(d.rows[1][9] as number).toBeCloseTo(60 / 86_400, 12);
    expect(d.cells.get("F2")!.fmt).toBe("#,##0.00"); expect(d.cells.get("G2")!.fmt).toBe("#,##0.0"); expect(d.cells.get("J2")!.fmt).toBe("[h]:mm:ss"); expect(d.cells.has("E3")).toBe(false);
  });
});
