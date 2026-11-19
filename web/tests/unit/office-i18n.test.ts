import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { ACTIVE_JOB, DRIVER_STATES, JOB_FILTERS, NOT_COMPLETED_JOB, OPP_FILTERS, PERIODS, SETTLEMENT_STATUSES, agreementSummary, attentionItems } from "@/components/features/office-lib";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const mine = [...walk("src/components/features").filter((f) => /\/office-[^/]+\.tsx?$/.test(f)), ...walk("src/app/(app)/office"), ...walk("src/app/(app)/driver")];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("office portal strings (rdo.*)", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("rdo."));
  it("has a real Arabic and Urdu text with the same placeholders for every key", () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect(ar[k]?.trim(), `ar ${k}`).toBeTruthy(); expect(ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(ar[k]), `ar placeholders ${k}`).toBe(placeholders(en[k])); expect(placeholders(ur[k]), `ur placeholders ${k}`).toBe(placeholders(en[k]));
      if (!/^\{[a-z]+\} – \{[a-z]+\}$/.test(en[k])) { expect(ar[k], `ar ${k} is an English copy`).not.toBe(en[k]); expect(ur[k], `ur ${k} is an English copy`).not.toBe(en[k]); }
    }
  });
  it("defines every rdo key the screens use (literal keys and the dynamic families)", () => {
    const used = new Set<string>();
    for (const f of mine) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rdo\.[a-z0-9_]+)["'`]/g)) used.add(m[1]);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    const need: string[] = [];
    DRIVER_STATES.forEach((s) => need.push(`rdo.drv_s_${s}`));
    JOB_FILTERS.forEach((f) => need.push(`rdo.jobs_f_${f}`));
    OPP_FILTERS.forEach((f) => need.push(`rdo.opp_f_${f}`));
    PERIODS.forEach((p) => need.push(`rdo.rep_p_${p}`));
    for (const s of ["none", "pending", "active", "expiring", "expired"]) need.push(`rdo.agr_${s}`, `rdo.agr_${s}_hint`);
    SETTLEMENT_STATUSES.forEach((s) => need.push(`settle.${s}`));
    [...ACTIVE_JOB, ...NOT_COMPLETED_JOB, "completed"].forEach((s) => need.push(`jobstatus.${s}`));
    expect(need.filter((k) => !(k in en)).sort()).toEqual([]);
  });
  it("defines the text and link label of every dashboard attention item", () => {
    const all = attentionItems({
      readiness: { verification: "pending", agreement: "none", ready: false }, agreement: agreementSummary([], new Date()), docs: { expired: 1, expiring: 1, attention: 1 },
      drivers: [{ verificationStatus: "pending" }], invites: 1, opportunities: { ready: 1 }, jobs: [{ status: "qty_disputed", parcels: null }], failedCents: 1,
    });
    const other = [
      ...attentionItems({ readiness: { verification: "verified", agreement: "none", ready: false }, agreement: agreementSummary([], new Date()) }),
      ...attentionItems({ agreement: agreementSummary([{ id: "1", version: 1, status: "accepted", terms: null, acceptedAt: null, expiresAt: "2020-01-01T00:00:00Z", effectiveAt: null, createdAt: "2020-01-01T00:00:00Z" }], new Date()) }),
      ...attentionItems({ agreement: agreementSummary([{ id: "1", version: 1, status: "accepted", terms: null, acceptedAt: null, expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), effectiveAt: null, createdAt: "2020-01-01T00:00:00Z" }], new Date()) }),
    ];
    const missing = [...all, ...other].flatMap((i) => [i.key, i.cta]).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    expect([...all, ...other].map((i) => i.id)).toEqual(expect.arrayContaining(["verify", "agreement", "docs_expired", "docs_attention", "docs_expiring", "failed_pay", "jobs", "drivers_unverified", "opps", "invites"]));
  });
});
