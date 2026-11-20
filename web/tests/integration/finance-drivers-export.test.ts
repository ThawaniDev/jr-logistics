/**
 * Finance › Drivers exports (J7): `format=csv|xlsx` on the list and on the five tables of one driver, and "Download full statement" (`…/:id/statement?format=xlsx`).
 * Needs finance.view AND reports.export, is audited as `report.export`, is formula-safe, masks phone numbers, localizes the Excel sheets (ar is right to left) and the numbers equal the screen.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { resetDb, shutdown, mkStaff } from "../helpers/factories";
import { PERIOD, seedFinanceDriversWorld } from "../helpers/finance-drivers-world";
import { call } from "../helpers/api";
import { readXlsx, type ReadSheet } from "../helpers/xlsx-read";
import { createSession } from "@/server/auth/session";
import { dispatch } from "@/server/api/router";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { translate } from "@/i18n/core";
import { dictionaries } from "@/i18n/dictionaries";
import { FD_COLS } from "@/server/finance-drivers-lib";
import { tableColumns } from "@/server/finance-drivers-cols";
import { XLSX_MIME } from "@/server/export/xlsx";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const BASE = "/admin/finance/drivers";
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const t = (lang: "ar" | "en" | "ur", key: string, vars?: Record<string, string | number>) => translate(dictionaries[lang], dictionaries.en, key, vars);
async function bin(u: { id: string }, path: string) {
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { headers: { host: "localhost", authorization: `Bearer ${await tok(u)}` } }));
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, text: buf.toString("utf8"), json: res.status === 200 ? null : JSON.parse(buf.toString("utf8")) };
}
const sheets = async (u: { id: string }, path: string) => { const r = await bin(u, path); expect(r.status, path).toBe(200); expect(r.headers.get("content-type")).toBe(XLSX_MIME); return readXlsx(r.buf); };
const csv = (text: string) => { expect(text.charCodeAt(0)).toBe(0xfeff); return text.slice(1).split("\n").map((l) => l.split(",")); };
const exports = () => db.select().from(auditLogs).where(eq(auditLogs.action, "report.export")).orderBy(desc(auditLogs.createdAt));
const col = (s: ReadSheet, header: string) => s.rows[0].findIndex((h) => typeof h === "string" && h.startsWith(header));
const staff = (...perms: string[]) => mkStaff(perms);

describe("permissions", () => {
  it("csv and xlsx need finance.view AND reports.export; refused requests are not audited", async () => {
    const w = await seedFinanceDriversWorld();
    const id = w.d3.id;
    const paths = [`${BASE}?format=csv`, `${BASE}?format=xlsx`, ...["statement", "settlements", "ledger", "withdrawals", "cash"].flatMap((x) => [`${BASE}/${id}/${x}?format=csv`, `${BASE}/${id}/${x}?format=xlsx`]), `${BASE}/${id}/statement?format=xlsx&scope=table`];
    const onlyFinance = await staff("finance.view"), onlyExport = await staff("reports.export", "reports.view"), both = await staff("finance.view", "reports.export");
    for (const p of paths) {
      expect((await bin(w.biz, p)).status, `${p} business`).toBe(403);
      expect((await bin(onlyFinance, p)).status, `${p} finance only`).toBe(403);
      expect((await bin(onlyExport, p)).status, `${p} export only`).toBe(403);
      expect((await call("GET", p)).status, `${p} anonymous`).toBe(401);
    }
    expect(await exports()).toHaveLength(0);
    for (const p of paths) expect((await bin(both, p)).status, p).toBe(200);
    expect((await exports()).length).toBe(paths.length);
  });

  it("a bad lang or format is 422, an unknown driver 404 — and none of them is audited", async () => {
    const w = await seedFinanceDriversWorld();
    expect((await bin(w.admin, `${BASE}?format=xlsx&lang=fr`)).status).toBe(422);
    expect((await bin(w.admin, `${BASE}?format=pdf`)).status).toBe(422);
    expect((await bin(w.admin, `${BASE}/${w.d3.id}/ledger?format=xlsx&lang=xx`)).status).toBe(422);
    expect((await bin(w.admin, `${BASE}/00000000-0000-4000-8000-000000000000/cash?format=csv`)).status).toBe(404);
    expect((await bin(w.admin, `${BASE}/00000000-0000-4000-8000-000000000000/statement?format=xlsx`)).status).toBe(404);
    expect(await exports()).toHaveLength(0);
  });
});

describe("the list as CSV", () => {
  it("UTF-8 BOM, the column keys as header, one line per driver, phone masked without drivers.sensitive, audited", async () => {
    const w = await seedFinanceDriversWorld();
    const plain = await staff("finance.view", "reports.export");
    const r = await bin(plain, `${BASE}?${PERIOD}&format=csv`);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("finance-drivers-2026-05-10_2026-05-12.csv");
    const rows = csv(r.text);
    expect(rows[0]).toEqual([...FD_COLS.map((c) => c.key).flatMap((k) => (k === "officeName" ? [k, "paidViaOffice"] : [k]))]);
    expect(rows).toHaveLength(4);
    const d1 = rows.find((x) => x[0] === "Driver One")!, idx = (k: string) => rows[0].indexOf(k);
    expect(d1[idx("phone")]).toContain("•••");
    expect(d1[idx("earnedCents")]).toBe("3500");
    expect(d1[idx("walletAvailableCents")]).toBe(""); // an office driver has no wallet
    expect(d1[idx("paidViaOffice")]).toBe("true");
    const sensitive = csv((await bin(await staff("finance.view", "reports.export", "drivers.sensitive"), `${BASE}?${PERIOD}&format=csv`)).text);
    expect(sensitive.find((x) => x[0] === "Driver One")![idx("phone")]).toBe(`'${w.d1.phone}`); // a leading "+" is neutralised like any formula start (toCsv)
    const a = (await exports())[0];
    expect(a).toMatchObject({ actorId: expect.any(String), entity: "report", entityId: "finance/drivers" });
    expect(a.diff).toMatchObject({ rows: 3, truncated: false, format: "csv", table: "drivers", period: { from: "2026-05-10", to: "2026-05-12" } });
  });

  it("filters and sort apply to the file; a formula in a name is neutralised", async () => {
    const w = await seedFinanceDriversWorld();
    await db.update(users).set({ name: '=HYPERLINK("http://evil")' }).where(eq(users.id, w.d2.id));
    const rows = csv((await bin(w.admin, `${BASE}?${PERIOD}&hasCash=1&sort=cashHeldCents&dir=desc&format=csv`)).text);
    expect(rows).toHaveLength(3);
    expect(rows[1][0]).toBe("'=HYPERLINK(\"http://evil\")".replace(/"/g, '""').replace(/^/, '"').replace(/$/, '"')); // quoted because of the quotes, apostrophe first
    expect(rows[2][0]).toBe("Driver One");
  });
});

describe("the list as Excel", () => {
  it("localized sheet, typed cells, a totals row, a Notes sheet; right to left for Arabic", async () => {
    const w = await seedFinanceDriversWorld();
    const ar = await sheets(w.admin, `${BASE}?${PERIOD}&format=xlsx&lang=ar`);
    expect(ar.map((s) => s.name)).toEqual([t("ar", "fdr.title"), t("ar", "fr.sheet_notes")]);
    expect(ar[0].rtl && ar[1].rtl).toBe(true);
    const sheet = (await sheets(w.admin, `${BASE}?${PERIOD}&format=xlsx&lang=en`))[0];
    expect(sheet.rtl).toBe(false);
    expect(sheet.frozen).toBe(true);
    const earned = col(sheet, "Gross earnings"), wallet = col(sheet, "Wallet available"), office = col(sheet, "Office"), via = col(sheet, "Paid via office");
    expect(sheet.rows[0][earned]).toBe("Gross earnings (SAR)"); // money columns say their unit
    expect(sheet.rows).toHaveLength(5); // header, 3 drivers, totals
    const d1 = sheet.rows.find((r) => r[0] === "Driver One")!, d3 = sheet.rows.find((r) => r[0] === "Driver Three")!, total = sheet.rows[4];
    expect(d1[earned]).toBe(35); // halalas → SAR
    expect(sheet.cells.get(`${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"[earned] ?? "A"}2`)?.fmt ?? "#,##0.00").toMatch(/#,##0\.00/);
    expect(d1[wallet]).toBeNull();
    expect(d1[via]).toBe("Yes");
    expect(d3[office]).toBe("Independent");
    expect(d3[via]).toBe("No");
    expect(d3[wallet]).toBe(2.5);
    expect(total[0]).toBe("Totals");
    expect(total[earned]).toBe(70);
    const notes = (await sheets(w.admin, `${BASE}?${PERIOD}&format=xlsx&lang=en`))[1].rows.flat().filter(Boolean).join("\n");
    expect(notes).toContain("Finance › Drivers");
    expect(notes).toContain("2026-05-10");
    expect(notes).toContain("Paid via office");
    expect(notes).toContain("Gross earnings = the provider amount");
  });

  it("the Arabic file has Arabic headers and 'independent' in Arabic; the default language is the viewer's", async () => {
    const w = await seedFinanceDriversWorld();
    await db.update(users).set({ language: "ur" }).where(eq(users.id, w.admin.id));
    const ur = (await sheets(w.admin, `${BASE}?${PERIOD}&format=xlsx`))[0];
    expect(ur.rtl).toBe(true);
    expect(ur.rows[0].some((h) => typeof h === "string" && h.startsWith(t("ur", "fdr.col_earnedCents")))).toBe(true);
    const ar = (await sheets(w.admin, `${BASE}?${PERIOD}&format=xlsx&lang=ar`))[0];
    expect(ar.rows.find((r) => r[0] === "Driver Three")).toContain(t("ar", "fdr.independent"));
  });
});

describe("one driver's tables", () => {
  it("each table downloads as CSV and Excel with the same rows as the screen, audited per table", async () => {
    const w = await seedFinanceDriversWorld();
    const id = w.d3.id, q = "period=all";
    const expectRows: Record<string, number> = { statement: 8, settlements: 1, ledger: 7, withdrawals: 3, cash: 0 };
    for (const table of ["statement", "settlements", "ledger", "withdrawals", "cash"] as const) {
      const screen = (await call("GET", `${BASE}/${id}/${table}?${q}`, { token: await tok(w.admin) })).json;
      expect(screen.total, table).toBe(expectRows[table]);
      const c = csv((await bin(w.admin, `${BASE}/${id}/${table}?${q}&format=csv${table === "statement" ? "&scope=table" : ""}`)).text);
      expect(c[0], table).toEqual(tableColumns(table).map((x) => (x.key === "typeLabel" ? "kind" : x.key)));
      expect(c.length - 1, table).toBe(expectRows[table]);
      const x = await sheets(w.admin, `${BASE}/${id}/${table}?${q}&format=xlsx&lang=en${table === "statement" ? "&scope=table" : ""}`);
      expect(x.map((s) => s.name), table).toEqual([t("en", `fdr.tab_${table}`), "Notes"]);
      expect(x[0].rows.length - 1, table).toBe(expectRows[table]);
      expect(x[0].rows[0].length, table).toBe(tableColumns(table).length);
    }
    const log = await exports();
    expect(log.map((l) => l.entityId)).toEqual(expect.arrayContaining(["statement", "settlements", "ledger", "withdrawals", "cash"].map((n) => `finance/drivers/${id}/${n}`)));
    expect(log.find((l) => l.entityId === `finance/drivers/${id}/ledger`)!.diff).toMatchObject({ rows: 7, format: "xlsx", table: "ledger", driverId: id });
  });

  it("signed amounts are two non-negative columns; the ledger keeps the running balance; no full IBAN leaves the server", async () => {
    const w = await seedFinanceDriversWorld();
    const ledger = csv((await bin(w.admin, `${BASE}/${w.d3.id}/ledger?period=all&format=csv`)).text);
    const [h, ...rows] = ledger;
    expect(rows.flat().some((c) => c.startsWith("-") || c.startsWith("'-"))).toBe(false);
    const bal = rows.map((r) => Number(r[h.indexOf("balanceCents")]));
    expect(bal[0]).toBe(250); // newest first
    const wd = (await bin(w.admin, `${BASE}/${w.d3.id}/withdrawals?period=all&format=csv`)).text;
    expect(wd).not.toContain("SA0380000000608010167519");
    expect(wd).toContain("•••• 7519");
  });

  it("the statement sheet names each row's type in the viewer's language", async () => {
    const w = await seedFinanceDriversWorld();
    const s = (await sheets(w.admin, `${BASE}/${w.d3.id}/statement?period=all&format=xlsx&scope=table&lang=ar`))[0];
    const type = s.rows[0].indexOf(t("ar", "fdr.c_type"));
    const types = s.rows.slice(1).map((r) => r[type]);
    expect(types).toContain(t("ar", "ledger.payout"));
    expect(types.some((x) => typeof x === "string" && x.startsWith(t("ar", "fdr.st_earned")))).toBe(true);
  });

  it("the period filter applies to the file", async () => {
    const w = await seedFinanceDriversWorld();
    const c = csv((await bin(w.admin, `${BASE}/${w.d3.id}/ledger?from=2026-05-15&to=2026-05-16&format=csv`)).text);
    expect(c).toHaveLength(4);
  });
});

describe("Download full statement", () => {
  it("one workbook: Summary, Statement, Settlements, Wallet ledger, Withdrawals, Cash on delivery, Notes", async () => {
    const w = await seedFinanceDriversWorld();
    const all = await sheets(w.admin, `${BASE}/${w.d3.id}/statement?period=all&format=xlsx&lang=en`);
    expect(all.map((s) => s.name)).toEqual(["Summary", "Statement", "Settlements", "Wallet ledger", "Withdrawals", "Cash on delivery", "Notes"]);
    const [summary, statement, settlements, ledger, withdrawals, cash, notes] = all;
    expect([statement, settlements, ledger, withdrawals, cash].map((s) => s.rows.length - 1)).toEqual([8, 1, 7, 3, 0]);
    const line = (label: string) => summary.rows.find((r) => r[0] === label)!;
    expect(line("Gross earnings")[1]).toBe(10.5);
    expect(line("Wallet available")[1]).toBe(2.5);
    expect(line("Withdrawals paid")[1]).toBe(5);
    expect(line("Office")[1]).toBe("Independent");
    expect(line("Penalties (wallet debits)")[1]).toBe(2);
    expect(notes.rows.flat().filter(Boolean).join("\n")).toContain("Driver Three");
    const log = (await exports())[0];
    expect(log).toMatchObject({ entity: "report", entityId: `finance/drivers/${w.d3.id}/workbook` });
    expect(log.diff).toMatchObject({ workbook: "driver_statement", id: w.d3.id, format: "xlsx", rows: 8 + 1 + 7 + 3 });
  });

  it("an office driver's summary says the wallet is paid via the office; Arabic is right to left with Arabic sheet names; the period applies", async () => {
    const w = await seedFinanceDriversWorld();
    const ar = await sheets(w.admin, `${BASE}/${w.d1.id}/statement?${PERIOD}&format=xlsx&lang=ar`);
    expect(ar.map((s) => s.name)).toEqual([t("ar", "fr.sheet_summary"), t("ar", "fdr.tab_statement"), t("ar", "fdr.tab_settlements"), t("ar", "fdr.tab_ledger"), t("ar", "fdr.tab_withdrawals"), t("ar", "fdr.tab_cash"), t("ar", "fr.sheet_notes")]);
    expect(ar.every((s) => s.rtl)).toBe(true);
    const wallet = ar[0].rows.find((r) => r[0] === t("ar", "fdr.col_walletAvailableCents"))!;
    expect(wallet[1]).toBe(t("ar", "fdr.paid_via_office"));
    expect(ar[3].rows).toHaveLength(1); // an empty ledger: the header only
    const day10 = await sheets(w.admin, `${BASE}/${w.d1.id}/statement?from=2026-05-11&to=2026-05-11&format=xlsx&lang=en`);
    expect(day10[2].rows.length - 1).toBe(0); // no settlement created on the 11th
    expect(day10[1].rows.length - 1).toBe(1); // the hand-over
  });

  it("scope=table is just the statement sheet; format=csv is the statement rows", async () => {
    const w = await seedFinanceDriversWorld();
    expect((await sheets(w.admin, `${BASE}/${w.d1.id}/statement?${PERIOD}&format=xlsx&scope=table&lang=en`)).map((s) => s.name)).toEqual([t("en", "fdr.tab_statement"), "Notes"]);
    expect(csv((await bin(w.admin, `${BASE}/${w.d1.id}/statement?${PERIOD}&format=csv`)).text)).toHaveLength(5);
  });
});
