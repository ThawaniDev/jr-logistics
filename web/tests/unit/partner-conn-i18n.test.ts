import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as conn from "@/i18n/fragments/partners-v2-conn";
import * as business from "@/i18n/fragments/partners-business";
import * as core from "@/i18n/fragments/partners-core";
import * as admin from "@/i18n/fragments/partners-admin";
import { listAdapters } from "@/server/partners/registry";
import { JR_EVENTS, EVENT_KINDS } from "@/server/partners/types";

/**
 * The connection screens' strings (fragment partners-v2-conn): en / ar / ur parity, placeholders, real translations, and coverage of every
 * key the screens build at run time (events, kinds, modes, directions) and of every registered system's name, description and form fields.
 * Imports the fragments directly so it does not depend on the rest of the dictionary.
 */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const SOURCES = [
  ...readdirSync("src/components/features").filter((f) => f.startsWith("partner-conn-")).map((f) => `src/components/features/${f}`),
  "src/components/features/admin-system-integrations.tsx",
  ...walk("src/app/(app)/business/integrations").filter((f) => !f.includes("/orders/")),
  ...walk("src/app/(app)/admin/integrations").filter((f) => !f.includes("/orders/")),
];
const known = { ...core.en, ...business.en, ...admin.en, ...conn.en };

describe("partners-v2-conn fragment", () => {
  it("en / ar / ur have exactly the same keys", () => {
    const e = Object.keys(conn.en).sort();
    expect(Object.keys(conn.ar).sort()).toEqual(e);
    expect(Object.keys(conn.ur).sort()).toEqual(e);
  });
  it("no empty values, the same placeholders in every language", () => {
    for (const [k, v] of Object.entries(conn.en)) {
      expect(v.trim(), `en ${k}`).not.toBe("");
      expect(conn.ar[k]?.trim(), `ar ${k}`).toBeTruthy();
      expect(conn.ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(conn.ar[k]), `ar placeholders ${k}`).toBe(placeholders(v));
      expect(placeholders(conn.ur[k]), `ur placeholders ${k}`).toBe(placeholders(v));
    }
  });
  it("Arabic and Urdu are real translations (iv2.* never equals the English)", () => {
    for (const k of Object.keys(conn.en).filter((x) => x.startsWith("iv2."))) {
      expect(conn.ar[k], `ar ${k}`).not.toBe(conn.en[k]);
      expect(conn.ur[k], `ur ${k}`).not.toBe(conn.en[k]);
    }
  });
  it("does not redefine keys owned by the other partner fragments", () => {
    const other = new Set([...Object.keys(core.en), ...Object.keys(business.en), ...Object.keys(admin.en)]);
    expect(Object.keys(conn.en).filter((k) => other.has(k))).toEqual([]);
  });
  it("every literal iv2.* key used by the connection screens exists", () => {
    const used = new Set<string>();
    for (const f of SOURCES) for (const m of readFileSync(f, "utf8").matchAll(/"(iv2\.[a-z_0-9]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(50);
    expect([...used].filter((k) => !(k in conn.en)).sort()).toEqual([]);
  });
  it("keys built at run time exist: JR events, meanings, modes, directions", () => {
    const need: string[] = [];
    for (const ev of JR_EVENTS) need.push(`iv2.ev_${ev}`, `iv2.evh_${ev}`);
    for (const k of EVENT_KINDS) need.push(`iv2.kind_${k}`);
    for (const m of ["carrier", "merchant", "custom"]) need.push(`iv2.mode_${m}`, `iv2.mode_${m}_hint`, `iv2.group_${m}`);
    for (const d of ["in", "out", "lookup", "test", "poll"]) need.push(`iv2.dir_${d}`);
    expect(need.filter((k) => !(k in conn.en))).toEqual([]);
  });
  it("every registered system has a localised name, description and field labels (and help where the server has help)", () => {
    const need: string[] = [];
    for (const a of listAdapters()) {
      need.push(`intg.provider.${a.key}.label`, `intg.provider.${a.key}.desc`);
      for (const f of a.fields) {
        need.push(`intg.field.${a.key}.${f.key}`);
        if (f.help) need.push(`intg.field.${a.key}.${f.key}_help`);
        for (const o of f.options ?? []) need.push(`intg.field.${a.key}.${f.key}_opt_${o.value}`);
      }
    }
    expect(need.filter((k) => !(k in known))).toEqual([]);
  });
});
