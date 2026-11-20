/**
 * Finance › Drivers (J7), pure parts: the column catalogue, row shaping (office drivers have no wallet columns, phone masking), the totals row, sort / filter / period parsing, the SQL pieces
 * the filters produce, the export columns and the translations of every key the page and the exports can ask for. No database.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import {
  FD_BY_KEY, FD_COLS, FD_DEFAULT_SORT, FD_GROUPS, filtersOf, intParam, LEDGER_KINDS, maskPhone, MAX_PERIOD_DAYS, resolvePeriod, shapeRow, shapeTotals, sortOf, statementTypeKey, STATEMENT_SOURCES, SUMMABLE, WALLET_KEYS,
} from "@/server/finance-drivers-lib";
import { listColumns, tableColumns, DETAIL_TABLES, colLabel, GROUP_LABEL } from "@/server/finance-drivers-cols";
import { baseChain, postFilter, whoCte } from "@/server/finance-drivers-sql";

const dialect = new PgDialect();
const q = (s: ReturnType<typeof whoCte>) => { const r = dialect.sqlToQuery(s); return { sql: r.sql.replace(/\s+/g, " ").trim(), params: r.params }; };
const qs = (s: string) => new URLSearchParams(s);
const rec = (o: Record<string, unknown> = {}) => ({ id: "d1", name: "Ali", username: "ali", phone: "+966501234567", city: "riyadh", status: "active", verification: "verified", office_id: null, office_name: null, via_office: false,
  wallet_available: 1000, wallet_held: 200, wallet_pending: 300, jobs: 4, delivered: 20, failed: 1, returned: 2, earned: 5000, paid: 4000, pending: 1000, last_payout_at: "2026-11-01T10:00:00Z", last_job_at: null, ...o });

describe("column catalogue", () => {
  it("keys and database columns are unique and every group is used", () => {
    expect(new Set(FD_COLS.map((c) => c.key)).size).toBe(FD_COLS.length);
    expect(new Set(FD_COLS.map((c) => c.db)).size).toBe(FD_COLS.length);
    for (const g of FD_GROUPS) expect(FD_COLS.some((c) => c.group === g), g).toBe(true);
  });
  it("has every column J7 asks for", () => {
    for (const k of ["name", "username", "phone", "city", "status", "verification", "officeName", "walletAvailableCents", "walletHeldCents", "walletPendingCents", "jobs", "delivered", "failed", "returned", "earnedCents", "paidCents", "pendingCents",
      "refundCents", "adjustCents", "penaltiesCents", "wdRequestedCents", "wdPaidCents", "wdPendingCents", "wdRejectedCents", "cashCollectedCents", "cashRemittedCents", "cashHeldCents", "periodJobs", "periodParcels", "periodEarnedCents", "periodPaidCents",
      "periodCashCollectedCents", "periodCashRemittedCents", "lastPayoutAt", "lastJobAt"]) expect(FD_BY_KEY.has(k), k).toBe(true);
  });
  it("money columns end in Cents, the wallet columns are the three wallet ones, counts and money are summable", () => {
    for (const c of FD_COLS) expect(c.kind === "money", c.key).toBe(c.key.endsWith("Cents"));
    expect(WALLET_KEYS.sort()).toEqual(["walletAvailableCents", "walletHeldCents", "walletPendingCents"]);
    expect(SUMMABLE.every((c) => c.kind === "money" || c.kind === "int")).toBe(true);
    expect(FD_COLS.filter((c) => c.on).map((c) => c.key)).toContain("name");
  });
  it("the export has every column plus the office flag; the detail tables have their columns", () => {
    const keys = listColumns().map((c) => c.key);
    for (const c of FD_COLS) expect(keys).toContain(c.key);
    expect(keys).toContain("paidViaOffice");
    for (const t of DETAIL_TABLES) expect(tableColumns(t).length, t).toBeGreaterThan(4);
    // signed amounts are exported as two non-negative columns (the CSV writer would turn a leading minus into text)
    expect(tableColumns("ledger").map((c) => c.key)).toEqual(expect.arrayContaining(["creditCents", "debitCents"]));
    expect(tableColumns("statement").map((c) => c.key)).toEqual(expect.arrayContaining(["inCents", "outCents"]));
  });
});

describe("shapeRow", () => {
  it("turns an SQL record into the API row (numbers, ISO dates, nulls)", () => {
    const r = shapeRow(rec(), true);
    expect(r).toMatchObject({ id: "d1", officeId: null, independent: true, paidViaOffice: false, name: "Ali", walletAvailableCents: 1000, walletPendingCents: 300, jobs: 4, earnedCents: 5000, lastPayoutAt: "2026-11-01T10:00:00.000Z", lastJobAt: null, officeName: null });
    expect(shapeRow(rec({ earned: "5000.0" }), true).earnedCents).toBe(5000); // pg may send numbers as text
  });
  it("an office driver has no wallet columns (null, paidViaOffice) but keeps earnings and cash", () => {
    const r = shapeRow(rec({ office_id: "o1", office_name: "Al Noor", via_office: true, cash_held: 700 }), true);
    expect(r).toMatchObject({ officeId: "o1", independent: false, paidViaOffice: true, officeName: "Al Noor", cashHeldCents: 700, earnedCents: 5000, paidCents: 4000 });
    for (const k of WALLET_KEYS) expect(r[k], k).toBeNull();
  });
  it("masks the phone without drivers.sensitive", () => {
    expect(shapeRow(rec(), false).phone).toBe("+966•••67");
    expect(shapeRow(rec(), true).phone).toBe("+966501234567");
    expect(maskPhone(null)).toBeNull();
    expect(shapeRow(rec({ phone: null }), false).phone).toBeNull();
  });
  it("counts default to 0 and money stays null when missing", () => {
    const r = shapeRow({ id: "x", name: "N" }, true);
    expect(r.jobs).toBe(0);
    expect(r.earnedCents).toBeNull();
  });
  it("totals sum the summable columns and count the drivers", () => {
    const t = shapeTotals({ n: 3, earned: 10000, paid: "400", wallet_available: null });
    expect(t).toMatchObject({ drivers: 3, earnedCents: 10000, paidCents: 400, walletAvailableCents: 0, jobs: 0 });
    expect(shapeTotals(undefined).drivers).toBe(0);
  });
});

describe("sort, paging and filters", () => {
  it("sort defaults to gross earnings, newest first; refuses unknown columns and directions", () => {
    expect(sortOf(qs(""))).toEqual(FD_DEFAULT_SORT);
    expect(sortOf(qs("sort=cashHeldCents&dir=asc"))).toEqual({ key: "cashHeldCents", dir: "asc" });
    expect(() => sortOf(qs("sort=password"))).toThrow(/Unknown sort/);
    expect(() => sortOf(qs("sort=name&dir=sideways"))).toThrow(/asc or desc/);
  });
  it("paging parameters are whole numbers inside their bounds", () => {
    expect(intParam(qs(""), "page", 1, 1, 10)).toBe(1);
    expect(intParam(qs("page=3"), "page", 1, 1, 10)).toBe(3);
    for (const bad of ["page=0", "page=1.5", "page=abc", "page=11"]) expect(() => intParam(qs(bad), "page", 1, 1, 10), bad).toThrow();
  });
  it("filters: search, office / independent, city, status, cash, pending", () => {
    expect(filtersOf(qs(""))).toEqual({ q: "", office: "", city: "", status: "", hasCash: false, hasPending: false });
    expect(filtersOf(qs("q=%20ali%20&office=independent&city=riyadh&status=suspended&hasCash=1&hasPending=1"))).toEqual({ q: "ali", office: "independent", city: "riyadh", status: "suspended", hasCash: true, hasPending: true });
    expect(filtersOf(qs("hasCash=0")).hasCash).toBe(false);
    expect(() => filtersOf(qs("office=nope"))).toThrow(/office/);
    expect(() => filtersOf(qs("status=gone"))).toThrow(/status/);
    expect(() => filtersOf(qs("city=a b"))).toThrow(/city/);
    expect(filtersOf(new URLSearchParams({ q: "x".repeat(200) })).q.length).toBe(80);
  });
});

describe("period", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  it("defaults to the last 30 Riyadh days", () => {
    const p = resolvePeriod(qs(""), now);
    expect(p).toMatchObject({ mode: "range", from: "2026-10-22", to: "2026-11-20", days: 30, isDefault: true });
    expect(p.start!.toISOString()).toBe("2026-10-21T21:00:00.000Z"); // Riyadh midnight
    expect(p.end!.toISOString()).toBe("2026-11-20T21:00:00.000Z");
  });
  it("takes from + to (inclusive), or period=all", () => {
    expect(resolvePeriod(qs("from=2026-11-01&to=2026-11-03"), now)).toMatchObject({ from: "2026-11-01", to: "2026-11-03", days: 3, isDefault: false });
    expect(resolvePeriod(qs("period=all"), now)).toMatchObject({ mode: "all", start: null, end: null });
  });
  it("refuses one date without the other, bad dates, reversed ranges and more than five years", () => {
    for (const bad of ["from=2026-11-01", "to=2026-11-01", "from=2026-13-01&to=2026-11-02", "from=2026-11-05&to=2026-11-01", "from=1999-01-01&to=1999-02-01", "from=2020-01-01&to=2026-01-01"]) expect(() => resolvePeriod(qs(bad), now), bad).toThrow();
    expect(MAX_PERIOD_DAYS).toBe(1830);
  });
});

describe("the SQL the filters produce", () => {
  const none = { q: "", office: "", city: "", status: "", hasCash: false, hasPending: false };
  it("no filter = every driver; user input only through parameters", () => {
    const r = q(whoCte(none));
    expect(r.sql).toContain("u.role = 'driver'");
    expect(r.params).toEqual([]);
    const f = q(whoCte({ ...none, q: "a%b", city: "riyadh", status: "active", office: "11111111-1111-4111-8111-111111111111" }));
    expect(f.sql).toContain("ilike");
    expect(f.params).toEqual(expect.arrayContaining(["%a\\%b%", "riyadh", "active", "11111111-1111-4111-8111-111111111111"]));
    expect(f.sql).not.toContain("riyadh");
  });
  it("independent = no office; one driver by id", () => {
    expect(q(whoCte({ ...none, office: "independent" })).sql).toContain("dp.office_id is null");
    expect(q(whoCte(none, { id: "d1" })).params).toEqual(["d1"]);
  });
  it("the search matches phone numbers only for viewers who may see them", () => {
    const withPhone = q(whoCte({ ...none, q: "5012" }));
    expect(withPhone.sql).toContain("u.phone ilike");
    expect(q(whoCte({ ...none, q: "5012" }, { phone: true })).sql).toContain("u.phone ilike");
    const without = q(whoCte({ ...none, q: "5012" }, { phone: false }));
    expect(without.sql).not.toContain("u.phone");
    expect(without.sql).toContain("u.username ilike");
  });
  it("cash / pending filters apply to the aggregated figures", () => {
    expect(q(postFilter(none)).sql).toBe("where true and true");
    expect(q(postFilter({ ...none, hasCash: true })).sql).toContain("cash_held > 0");
    expect(q(postFilter({ ...none, hasPending: true })).sql).toContain("pending > 0");
  });
  it("the chain restricts every aggregate to the selected drivers and uses the fleet definitions", () => {
    const p = resolvePeriod(qs("from=2026-11-01&to=2026-11-03"));
    const s = q(baseChain(none, p)).sql;
    expect(s.match(/in \(select id from who\)/g)!.length).toBeGreaterThanOrEqual(8);
    expect(s).toContain("settlements.status <> 'rejected'"); // BILLED
    expect(s).toContain("pending_review"); // PENDING_STATES
    expect(s).toContain("greatest(0,"); // cash held never below zero
    expect(q(baseChain(none, resolvePeriod(qs("period=all")))).params.filter((x) => typeof x === "string" && x.includes("T"))).toEqual([]); // all time: no window
  });
});

describe("statement helpers and translations", () => {
  it("names the type of a statement row", () => {
    expect(statementTypeKey("wallet", "payout")).toBe("ledger.payout");
    expect(statementTypeKey("settlement", "paid")).toBe("fdr.st_earned");
    expect(statementTypeKey("cod_collected", "collected")).toBe("fdr.st_cod_collected");
    expect(statementTypeKey("cod_remitted", "remitted")).toBe("fdr.st_cod_remitted");
    expect(STATEMENT_SOURCES).toHaveLength(4);
  });
  it("every key the screens and exports ask for exists in en, ar and ur", () => {
    const keys = new Set<string>(["nav.fin_drivers", "fdr.title", "fdr.workbook_title", "fdr.totals", "fdr.independent", "fdr.paid_via_office", "fdr.yes", "fdr.no", "fdr.xl_item", "fdr.xl_value", "fdr.period_all", "fdr.period_value", "fdr.open_finance"]);
    for (const c of FD_COLS) keys.add(colLabel(c.key));
    keys.add(colLabel("paidViaOffice"));
    for (const g of Object.values(GROUP_LABEL)) keys.add(g);
    for (const t of DETAIL_TABLES) { keys.add(`fdr.tab_${t}`); for (const c of tableColumns(t)) { keys.add(c.label); if (c.type === "enum" && c.ns?.startsWith("fdr_src")) for (const s of STATEMENT_SOURCES) keys.add(`fdr_src.${s}`); } }
    for (const k of LEDGER_KINDS) keys.add(`ledger.${k}`);
    for (const n of ["money", "wallet", "earned", "cash", "period", "penalties", "statement", "cash_rows", "ledger", "cash_tab"]) keys.add(`fdr.note_${n}`);
    for (const [name, d] of [["en", en], ["ar", ar], ["ur", ur]] as const) for (const k of keys) expect(d[k], `${name}: ${k}`).toBeTruthy();
  });
  it("every fdr. / cdc. key exists in all three languages with the same placeholders", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(en).filter((x) => /^(fdr|cdc|fdr_src)\./.test(x))) for (const d of [ar, ur]) { expect(d[k], k).toBeTruthy(); expect(ph(d[k]), k).toBe(ph(en[k])); }
  });
});
