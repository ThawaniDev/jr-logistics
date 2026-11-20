import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import "@/server/analytics/explorer";
import { allDatasets, defineDataset, getDataset } from "@/server/analytics/explorer-registry";
import { DATASET_GROUPS, maskSql, type Column, type Dataset } from "@/server/analytics/explorer-core";
import { MULTI_KEYS } from "@/server/analytics/keys";

const dialect = new PgDialect();
const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);
const CTX = { graceMin: 30 };
const run = (c: Column) => (typeof c.sql === "function" ? c.sql(CTX) : c.sql);
const sets = allDatasets();

/** The words of a value: its dictionary namespace, else the explorer's own `rpq.v_*` key. */
const hasWord = (d: Record<string, string>, ns: string | undefined, v: string) => (ns && `${ns}.${v}` in d) || `rpq.v_${v}` in d;
const missing = (keys: string[]) => keys.filter((k) => !(k in en) || !(k in ar) || !(k in ur));

describe("the dataset registry", () => {
  it("defines every dataset the owner asked for, once", () => {
    const keys = sets.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["requests", "parcels", "jobs", "settlements", "ledger", "withdrawals", "invoices", "cod", "companies", "offices", "drivers", "tickets", "complaints", "ratings", "custody", "documents", "logins", "messages", "availability", "parcel-events", "audit", "cancellations", "start-sla"]) expect(getDataset(k), k).toBeTruthy();
    // the legacy report types of GET /admin/reports/:type all have a dataset
    for (const legacy of ["requests", "settlements", "drivers", "cancellations", "start-sla", "complaints", "custody", "withdrawals"]) expect(getDataset(legacy), legacy).toBeTruthy();
    expect(sets.every((d) => (DATASET_GROUPS as readonly string[]).includes(d.group))).toBe(true);
  });
  it("finance datasets need finance.view, system datasets audit.view", () => {
    for (const k of ["settlements", "ledger", "withdrawals", "invoices", "cod"]) expect(getDataset(k)!.needs, k).toEqual(["finance.view"]);
    for (const k of ["logins", "messages", "parcel-events", "audit"]) expect(getDataset(k)!.needs, k).toEqual(["audit.view"]);
    for (const k of ["requests", "parcels", "jobs", "tickets", "complaints", "ratings", "companies", "offices", "drivers"]) expect(getDataset(k)!.needs ?? [], k).toEqual([]);
  });
  it("money columns and filters are flagged, so they vanish without finance.view", () => {
    for (const d of sets) {
      for (const c of d.columns) { if (/Cents$/.test(c.key)) { expect(c.money, `${d.key}.${c.key}`).toBe(true); expect(c.type, `${d.key}.${c.key}`).toBe("money"); } if (c.type === "money") expect(c.money, `${d.key}.${c.key}`).toBe(true); }
      for (const f of d.filters) if (/(total|amount|customer|margin)$/i.test(f.key) && f.kind === "num") expect(f.money, `${d.key}.f.${f.key}`).toBe(true);
    }
  });
  it("personal data is masked: phones, e-mails, IBANs, national ids, plates, recipients, addresses, IPs", () => {
    const masked = (d: string, k: string) => getDataset(d)!.columns.find((c) => c.key === k)?.mask;
    for (const [d, k] of [["drivers", "phone"], ["drivers", "email"], ["drivers", "nationalId"], ["drivers", "iban"], ["drivers", "vehiclePlate"], ["companies", "phone"], ["offices", "iban"], ["withdrawals", "iban"], ["parcels", "recipientName"], ["parcels", "recipientPhone"], ["parcels", "address"], ["requests", "recipientPhone"], ["logins", "ip"], ["logins", "identifier"], ["audit", "ip"], ["documents", "fileName"]]) expect(masked(d, k), `${d}.${k}`).toBeTruthy();
  });
  it("every dataset has plain keys, a unique id, sortable defaults and honest shared filters", () => {
    for (const d of sets) {
      expect(d.columns.some((c) => c.default), d.key).toBe(true);
      expect(d.keys.every((k) => (MULTI_KEYS as readonly string[]).includes(k)), d.key).toBe(true);
      for (const c of d.columns) { expect(c.key, `${d.key}.${c.key}`).toMatch(/^[a-z][A-Za-z0-9]*$/); expect(render(sql`select ${run(c)}`).sql, `${d.key}.${c.key}`).toBeTruthy(); }
      for (const f of d.filters) { const e = typeof f.sql === "function" ? f.sql(CTX) : f.sql; expect(render(sql`select ${e}`).sql).toBeTruthy(); if (f.kind === "enum") expect(f.values?.length || f.ns, `${d.key}.${f.key}`).toBeTruthy(); }
    }
  });
  it("rejects a bad definition at load time", () => {
    const base = getDataset("requests")!;
    const bad = (patch: Partial<Dataset>) => () => defineDataset({ ...base, key: "tmp-x", ...patch });
    expect(bad({ key: "Bad Key" })).toThrow(/lower-case/);
    expect(bad({ columns: [{ key: "a-b", type: "text", sql: sql`1`, default: true }], defaultSort: { key: "a-b", dir: "asc" } })).toThrow(/plain identifier/);
    expect(bad({ columns: [{ key: "a", type: "text", sql: sql`1`, default: true }, { key: "a", type: "text", sql: sql`1` }], defaultSort: { key: "a", dir: "asc" } })).toThrow(/duplicate column/);
    expect(bad({ columns: [{ key: "a", type: "money", money: true, sql: sql`1`, default: true }], defaultSort: { key: "a", dir: "asc" } })).toThrow(/default sort/);
    expect(bad({ columns: [{ key: "a", type: "text", sql: sql`1`, fields: { id: sql`1` }, default: true }], defaultSort: { key: "a", dir: "asc" } })).toThrow(/hidden field/);
  });
});

it("registering a dataset again replaces it (dev hot reload re-evaluates the modules)", () => {
  const base = getDataset("requests")!;
  expect(() => defineDataset({ ...base })).not.toThrow();
  expect(getDataset("requests")?.key).toBe("requests");
});

describe("masking", () => {
  it("keeps the last digits of a phone, the domain of an e-mail, and nothing of free text", () => {
    expect(render(maskSql("phone", sql`users.phone`)).sql).toContain("right(users.phone::text, 4)");
    expect(render(maskSql("tail", sql`x`)).sql).toContain("right(x::text, 3)");
    expect(render(maskSql("email", sql`users.email`)).sql).toContain("strpos(users.email::text, '@')");
    expect(render(maskSql("ip", sql`x`)).sql).not.toContain("right(");
    expect(render(maskSql("text", sql`x`)).sql).toContain("'•••'");
  });
});

describe("explorer translations (en, ar, ur)", () => {
  it("every dataset, group, time label, column and filter has a label", () => {
    const need = new Set<string>();
    for (const g of DATASET_GROUPS) need.add(`rpq.dg_${g}`);
    for (const d of sets) {
      need.add(`rpq.ds_${d.key}`); need.add(`rpq.ds_${d.key}_d`); need.add(d.time.label);
      for (const c of d.columns) need.add(`rpq.c_${c.key}`);
      for (const f of d.filters) need.add(`rpq.f_${f.key}`);
    }
    expect(missing([...need]).sort()).toEqual([]);
  });
  it("every closed set of values is translated: the column's namespace or an explorer word", () => {
    const gaps: string[] = [];
    for (const d of sets) {
      for (const c of d.columns) for (const v of c.values ?? []) for (const [name, dict] of [["en", en], ["ar", ar], ["ur", ur]] as const) if (!hasWord(dict, c.ns, v)) gaps.push(`${name} ${d.key}.${c.key}=${v} (${c.ns ?? "-"})`);
      for (const f of d.filters) for (const v of f.values ?? []) for (const [name, dict] of [["en", en], ["ar", ar], ["ur", ur]] as const) if (!hasWord(dict, f.ns, v)) gaps.push(`${name} ${d.key}.f.${f.key}=${v} (${f.ns ?? "-"})`);
    }
    expect([...new Set(gaps)].sort()).toEqual([]);
  });
  it("every rpq.* key has the same placeholders in en, ar and ur, and none is empty", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad: string[] = [];
    for (const k of Object.keys(en).filter((x) => x.startsWith("rpq."))) {
      if (!ar[k] || !ur[k] || !en[k]) { bad.push(`${k}: missing`); continue; }
      if (ph(en[k]) !== ph(ar[k]) || ph(en[k]) !== ph(ur[k])) bad.push(`${k}: placeholders`);
    }
    expect(bad).toEqual([]);
  });
});
