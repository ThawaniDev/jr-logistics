/**
 * Static contract between the notification EMITTERS (server code) and the notification TEMPLATES (`notif.<type>` in en / ar / ur):
 * every placeholder of a template is supplied by every emitter of that type. Parses the object literal of each `notify(...)`, `notifyMany(...)`,
 * `notifyOps(...)` and demo-history `R.notify(...)` call. Emitters whose type or data is not a literal (variables, spreads) are listed and covered by the runtime
 * check in `tests/integration/lifecycle-audit.test.ts` (every notification row written by real flows).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { dictionaries } from "@/i18n/dictionaries";
import { placeholdersOf } from "@/lib/notif-text";

const ROOT = path.resolve(__dirname, "../../src/server");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });

/** Splits the argument list that starts right after `(` at `from` into top-level arguments (strings, template literals, comments, brackets aware). */
export function argsAt(src: string, from: number): string[] {
  const args: string[] = []; let depth = 0, cur = "", i = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; cur += c; for (i++; i < src.length && src[i] !== q; i++) { cur += src[i]; if (src[i] === "\\") cur += src[++i] ?? ""; } cur += q; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) { if (depth === 0) { if (cur.trim()) args.push(cur.trim()); return args; } depth--; }
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return args;
}
/** Top-level keys of an object literal `{ a, b: 1, "c": 2, ...x }`; `null` when it is not a literal or has a spread. */
export function keysOf(arg: string | undefined): Set<string> | null {
  if (arg === undefined || arg === "undefined") return new Set();
  if (!arg.startsWith("{") || !arg.endsWith("}")) return null;
  const inner = argsAt(arg.slice(1) + ")", 0);
  const keys = new Set<string>();
  for (const e of inner) {
    if (e.startsWith("...")) return null;
    const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(e);
    if (!m) return null;
    keys.add(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

interface Emit { at: string; type: string | null; keys: Set<string> | null }
const emits: Emit[] = [];
for (const f of files(ROOT)) {
  if (f.endsWith("/notify.ts")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?<![\w.$])(R\.notify|notifyMany|notifyOps|notify)\(/g)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    const args = argsAt(src, m.index! + m[0].length);
    const ti = m[1] === "R.notify" ? 2 : 1;
    const lit = /^"([a-z0-9_]+)"$/.exec(args[ti] ?? "");
    emits.push({ at: `${path.relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length}`, type: lit ? lit[1] : null, keys: keysOf(args[ti + 1]) });
  }
}

const en = dictionaries.en;
const supplied = (keys: Set<string>) => new Set([...keys, ...(keys.has("amountCents") ? ["amount"] : [])]);

describe("notification emitters vs templates", () => {
  it("finds the emitters (the parser is not silently matching nothing)", () => {
    expect(emits.length).toBeGreaterThan(100);
    expect(emits.filter((e) => e.type && e.keys).length).toBeGreaterThan(80);
  });

  it("every literal emitter supplies every placeholder of its template (or the template has a short variant it fully supplies)", () => {
    const bad: string[] = [];
    for (const e of emits) {
      if (!e.type || !e.keys) continue;
      const tpl = en[`notif.${e.type}`];
      if (tpl === undefined) continue; // covered by the next test
      const have = supplied(e.keys);
      const miss = placeholdersOf(tpl).filter((p) => !have.has(p));
      if (!miss.length) continue;
      const short = en[`notif.${e.type}__short`];
      if (short !== undefined && placeholdersOf(short).every((p) => have.has(p))) continue;
      bad.push(`${e.at}  ${e.type}: missing {${miss.join("}, {")}}`);
    }
    expect(bad).toEqual([]);
  });

  it("every literal notification type has a text in en, ar and ur (otherwise the user sees the generic 'new update')", () => {
    const types = [...new Set(emits.flatMap((e) => (e.type ? [e.type] : [])))];
    const bad = types.filter((t) => !(`notif.${t}` in dictionaries.en) || !(`notif.${t}` in dictionaries.ar) || !(`notif.${t}` in dictionaries.ur));
    expect(bad).toEqual([]);
  });

  it("a template has the same placeholders in en, ar and ur", () => {
    const bad: string[] = [];
    for (const k of Object.keys(en).filter((x) => x.startsWith("notif."))) {
      const a = placeholdersOf(en[k]).sort().join(","), b = placeholdersOf(dictionaries.ar[k] ?? "").sort().join(","), c = placeholdersOf(dictionaries.ur[k] ?? "").sort().join(",");
      if (a !== b || a !== c) bad.push(`${k}: en {${a}} ar {${b}} ur {${c}}`);
    }
    expect(bad).toEqual([]);
  });

  it("emitters with a non-literal type or data are few and known (they are covered by the runtime check)", () => {
    const dynamic = emits.filter((e) => !e.type || !e.keys).map((e) => `${e.at}${e.type ? ` ${e.type}` : " <dynamic type>"}${e.keys ? "" : " <dynamic data>"}`);
    expect(dynamic.length, dynamic.join("\n")).toBeLessThan(40);
  });
});

describe("the parser itself", () => {
  it("reads keys, shorthand, quoted keys, nested braces and strings with commas; refuses spreads", () => {
    expect([...keysOf('{ requestId, ref: r.ref, "x": [1, 2], note: "a, b", n: { deep: 1 }, t: `${a ? "x" : "y"}` }')!].sort()).toEqual(["n", "note", "ref", "requestId", "t", "x"]);
    expect(keysOf("{ ...rest, a: 1 }")).toBeNull();
    expect(keysOf("data")).toBeNull();
    expect(keysOf(undefined)).toEqual(new Set());
  });
  it("would have flagged the original manual-assignment call (offer_new without parcels and cities)", () => {
    const src = 'await notify(driverId, "offer_new", { requestId, ref: r.ref }, tx);';
    const args = argsAt(src, src.indexOf("(") + 1);
    const have = supplied(keysOf(args[2])!);
    const miss = placeholdersOf(en["notif.offer_new"]).filter((p) => !have.has(p));
    expect(miss.sort()).toEqual(["deliveryCity", "parcels", "pickupCity"]);
    expect(placeholdersOf(en["notif.offer_new__short"]).every((p) => have.has(p))).toBe(false);
  });
});
