import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, officeProfiles, users } from "@/db/schema";
import { dirOf, isLocale, translate, type Locale } from "@/i18n/core";
import { dictionaries } from "@/i18n/dictionaries";
import { err } from "@/lib/errors";
import { getSettings } from "../settings";
import type { MultiKey } from "../analytics/keys";
import type { ResolvedFilters } from "../analytics/filters";

/** What every export needs to speak the viewer's language: `tr(key, vars)` plus the locale and whether sheets run right to left. */
export interface Tr {
  (key: string, vars?: Record<string, string | number>): string;
  locale: Locale; rtl: boolean;
  /** Whether the dictionary (or its English fallback) knows the key. */
  has(key: string): boolean;
}
export function translator(locale: Locale): Tr {
  const dict = dictionaries[locale], en = dictionaries.en;
  const fn = (key: string, vars?: Record<string, string | number>) => translate(dict, en, key, vars);
  return Object.assign(fn, { locale, rtl: dirOf(locale) === "rtl", has: (key: string) => key in dict || key in en });
}
/** `?lang=ar|en|ur` (422 for anything else), else the viewer's own language, else English. */
export function localeOf(query: URLSearchParams, user: { language?: string | null }): Locale {
  const raw = query.get("lang");
  if (raw) { if (!isLocale(raw)) throw err("VALIDATION", "lang must be ar, en or ur", { field: "lang" }); return raw; }
  return isLocale(user.language) ? user.language : "en";
}
/** `2026-11-20 14:05` on the Riyadh clock. */
export const riyadhStamp = (d: Date = new Date()): string => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Display names of accounts by id (company / office / driver filters in words); unknown ids keep their id. */
export async function namesOf(kind: "company" | "office" | "driver", ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter((i) => UUID.test(i));
  if (!valid.length) return new Map();
  const role = kind === "company" ? "business" : kind;
  const label = kind === "office" ? sql<string>`coalesce(${officeProfiles.officeName}, ${users.name})` : kind === "company" ? sql<string>`coalesce(${businessProfiles.companyName}, ${users.name})` : sql<string>`${users.name}`;
  const base = db.select({ id: users.id, name: label }).from(users);
  const joined = kind === "office" ? base.leftJoin(officeProfiles, eq(officeProfiles.userId, users.id)) : kind === "company" ? base.leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)) : base;
  const list = await joined.where(and(eq(users.role, role), inArray(users.id, valid))).limit(60);
  return new Map(list.map((r) => [r.id, r.name]));
}

export interface Described { period: string; compare: string | null; filters: string[] }
/** The period and the active filters in words (`City: Riyadh, Jeddah`), for the Notes sheet. `skip` leaves out filters the viewer did not choose (a portal's own id). */
export async function describeFilters(f: ResolvedFilters, tr: Tr, skip: readonly MultiKey[] = []): Promise<Described> {
  const win = (w: { from: string; to: string; days: number }) => tr("fr.xl_period_value", { from: w.from, to: w.to, days: w.days });
  const cities = new Map((await getSettings()).cities.map((c) => [c.key, c[tr.locale] || c.en]));
  const active = f.active.filter((k) => !skip.includes(k));
  const [company, office, driver] = await Promise.all((["company", "office", "driver"] as const).map((k) => (active.includes(k) ? namesOf(k, f[k]) : Promise.resolve(new Map<string, string>()))));
  const word = (k: MultiKey, v: string): string => {
    const ns = ({ service: "svc.", vehicle: "vehicle.", status: "status.", channel: "rpf.ch_", city: "city." } as Partial<Record<MultiKey, string>>)[k];
    if (k === "company") return company.get(v) ?? v;
    if (k === "office") return office.get(v) ?? v;
    if (k === "driver") return driver.get(v) ?? v;
    if (k === "city" && cities.has(v)) return cities.get(v)!;
    return ns && tr.has(ns + v) ? tr(ns + v) : v;
  };
  return {
    period: win(f.cur), compare: f.prev ? win(f.prev) : null,
    filters: active.map((k) => `${tr(`rpf.f_${k}`)}: ${f[k].map((v) => word(k, v)).join(", ")}`),
  };
}
