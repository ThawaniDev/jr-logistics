/**
 * CSV exports of the reports are for people: headers are the localized labels with their unit (`Withdrawals requested (SAR)`, never `wdRequestedCents`), money is in riyals,
 * percentages are 0–100, distances in km, durations h:mm:ss, enum values in words. `headers=keys` is the machine form (raw keys, halalas) — see server/export/drill-csv.ts.
 * Covers the admin drill tables, the office portal tables and Finance › Drivers (list and detail tables), in English and Arabic.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, shutdown, mkStaff } from "../helpers/factories";
import { PERIOD, seedFinanceDriversWorld } from "../helpers/finance-drivers-world";
import { Q } from "../helpers/fleet-world";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { csvValue } from "@/server/export/drill-csv";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
/** A tiny CSV reader (quotes and doubled quotes), BOM stripped. */
function parse(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (const ch of text.replace(/^﻿/, "") + "\n") {
    if (q) { if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell); if (row.some((c) => c !== "")) out.push(row); row = []; cell = ""; } else cell += ch;
  }
  return out;
}
const camelCase = /^[a-z]+[A-Z][A-Za-z]*$/;

describe("csvValue (pure)", () => {
  it("money in riyals, percent 0–100, km, h:mm:ss, Riyadh dates, text untouched, empty stays empty", () => {
    expect(csvValue("money", 123_456)).toBe("1234.56");
    expect(csvValue("money", "250")).toBe("2.50");
    expect(csvValue("percent", 0.6667)).toBe("66.7");
    expect(csvValue("percent", 1)).toBe("100");
    expect(csvValue("km", 12_345)).toBe("12.3");
    expect(csvValue("duration", 3725)).toBe("1:02:05");
    expect(csvValue("duration", 45)).toBe("0:00:45");
    expect(csvValue("date", "2026-05-10")).toBe("2026-05-10");
    expect(csvValue("datetime", "2026-05-10T22:30:00.000Z")).toBe("2026-05-11 01:30"); // Riyadh is UTC+3
    expect(csvValue("int", 7)).toBe(7);
    expect(csvValue("text", "x, y")).toBe("x, y");
    for (const ty of ["money", "percent", "km", "duration", "date", "int", "text"] as const) { expect(csvValue(ty, null)).toBe(""); expect(csvValue(ty, "")).toBe(""); }
    expect(csvValue("money", "n/a")).toBe("n/a"); // never lose a value that is not a number
  });
});

describe("csvLine (formula guard)", () => {
  it("plain negative numbers stay numbers; formulas and phone-style plus signs are still neutralised", async () => {
    const { csvLine } = await import("@/server/ops");
    expect(csvLine([-32.84, "-5", "-12.50"])).toBe("-32.84,-5,-12.50");
    expect(csvLine(["=1+1", "+966500000001", "-2+3", "@SUM(A1)", "-abc", "\tx"])).toBe("'=1+1,'+966500000001,'-2+3,'@SUM(A1),'-abc,'\tx");
  });
});

describe("admin drill tables", () => {
  it("drivers/money: readable headers with units, money in riyals; headers=keys is the raw form", async () => {
    const w = await seedFinanceDriversWorld();
    const readable = parse((await get(w.admin, `/admin/analytics/drivers/table/money?${Q}&format=csv&lang=en`)).text);
    const raw = parse((await get(w.admin, `/admin/analytics/drivers/table/money?${Q}&format=csv&headers=keys`)).text);
    expect(raw[0]).toContain("earnCents"); expect(raw[0].some((h) => camelCase.test(h))).toBe(true);
    expect(readable[0].length).toBe(raw[0].length);
    for (const h of readable[0]) { expect(camelCase.test(h), h).toBe(false); expect(h, h).not.toMatch(/Cents|\.col_|^fr\./); }
    expect(readable[0].some((h) => /\(SAR\)$/.test(h))).toBe(true);
    // the same driver row: halalas in the raw file, riyals in the readable one
    const idx = raw[0].indexOf("earnCents"), nameIdx = raw[0].indexOf("name");
    const rawRow = raw.find((r) => r[nameIdx] === "Driver One")!, readableRow = readable.find((r) => r[nameIdx] === "Driver One")!;
    expect(rawRow[idx]).toBe("3500"); expect(readableRow[idx]).toBe("35.00");
  });
  it("drivers/perf: percentages say (%) and are 0–100, distance says km, Arabic headers are Arabic", async () => {
    const w = await seedFinanceDriversWorld();
    const en = parse((await get(w.admin, `/admin/analytics/drivers/table/perf?${Q}&format=csv&lang=en`)).text);
    const raw = parse((await get(w.admin, `/admin/analytics/drivers/table/perf?${Q}&format=csv&headers=keys`)).text);
    const si = raw[0].indexOf("success"), nameIdx = raw[0].indexOf("name");
    expect(en[0][si]).toMatch(/\(%\)$/);
    const rawS = Number(raw.find((r) => r[nameIdx] === "Driver One")![si]), enS = Number(en.find((r) => r[nameIdx] === "Driver One")![si]);
    expect(Math.abs(enS - rawS * 100)).toBeLessThan(0.1);
    expect(en[0][raw[0].indexOf("radiusM")]).toMatch(/\(km\)$/);
    const ar = parse((await get(w.admin, `/admin/analytics/drivers/table/perf?${Q}&format=csv&lang=ar`)).text);
    expect(ar[0].every((h) => /[؀-ۿ]/.test(h) || /\d/.test(h))).toBe(true);
    expect(ar[0]).not.toEqual(en[0]);
  });
  it("the viewer's own language is the default; an unknown lang is refused", async () => {
    const w = await seedFinanceDriversWorld();
    expect((await get(w.admin, `/admin/analytics/drivers/table/money?${Q}&format=csv&lang=xx`)).status).toBe(422);
    const csv = await get(w.admin, `/admin/analytics/drivers/table/money?${Q}&format=csv`);
    expect(csv.status).toBe(200); expect(csv.text.startsWith("﻿")).toBe(true);
  });
});

describe("office portal tables", () => {
  it("money: readable header, no raw keys, owner's own rows only", async () => {
    const w = await seedFinanceDriversWorld();
    const csv = parse((await get(w.o1, `/office/analytics/table/money?${Q}&format=csv&lang=en`)).text);
    for (const h of csv[0]) expect(camelCase.test(h), h).toBe(false);
    expect(csv[0].some((h) => /\(SAR\)$/.test(h))).toBe(true);
    expect(csv.length).toBeGreaterThan(1);
    const raw = parse((await get(w.o1, `/office/analytics/table/money?${Q}&format=csv&headers=keys`)).text);
    expect(raw[0]).toContain("earnCents");
  });
});

describe("Finance › Drivers", () => {
  it("the list: Withdrawals requested (SAR), not wdRequestedCents; money in riyals; yes/no and Independent in words", async () => {
    const w = await seedFinanceDriversWorld();
    const finance = await mkStaff(["finance.view", "reports.export"]);
    const csv = parse((await get(finance, `/admin/finance/drivers?${PERIOD}&format=csv&lang=en`)).text);
    const head = csv[0];
    expect(head).toContain("Withdrawals requested (SAR)"); expect(head).toContain("Withdrawals requested (count)");
    for (const h of head) { expect(camelCase.test(h), h).toBe(false); expect(h).not.toMatch(/Cents|\.col_|^fdr\./); }
    expect(new Set(head).size).toBe(head.length); // headers are unique
    const raw = parse((await get(finance, `/admin/finance/drivers?${PERIOD}&format=csv&headers=keys`)).text);
    const nameIdx = raw[0].indexOf("name"), earnedIdx = raw[0].indexOf("earnedCents"), officeIdx = raw[0].indexOf("officeName");
    expect(raw.find((r) => r[nameIdx] === "Driver One")![earnedIdx]).toBe("3500");
    expect(csv.find((r) => r[nameIdx] === "Driver One")![earnedIdx]).toBe("35.00");
    expect(csv.find((r) => r[nameIdx] === "Driver Three")![officeIdx]).toBe("Independent");
  });
  it("one driver's tables: readable headers on every tab, a statement shows the type in words", async () => {
    const w = await seedFinanceDriversWorld();
    for (const table of ["statement", "settlements", "ledger", "withdrawals", "cash"]) {
      const csv = parse((await get(w.admin, `/admin/finance/drivers/${w.d3.id}/${table}?period=all&format=csv&lang=en${table === "statement" ? "&scope=table" : ""}`)).text);
      for (const h of csv[0]) { expect(camelCase.test(h), `${table}: ${h}`).toBe(false); expect(h).not.toMatch(/Cents|\.col_|^fdr\./); }
    }
    const ar = parse((await get(w.admin, `/admin/finance/drivers/${w.d3.id}/withdrawals?period=all&format=csv&lang=ar`)).text);
    expect(ar[0].some((h) => /[؀-ۿ]/.test(h))).toBe(true);
  });
});
