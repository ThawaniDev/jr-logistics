/**
 * The text of an in-app notification. Pure (no React, no i18n import) so every screen that lists notifications — and the tests — share one rule:
 * a raw `{placeholder}` is NEVER shown. The server stores `type` + `data`; the template is `notif.<type>` in the viewer's language.
 *
 *  1. values are the scalars of `data` (objects dropped, empty ones skipped), cities (`pickupCity`, `deliveryCity`) shown by their localized name,
 *     `amount` (SAR) derived from `amountCents`;
 *  2. every placeholder of the template has a value → the template;
 *  3. else the short variant `notif.<type>__short` when it exists and is fully supplied (e.g. a vehicle-day offer has no parcel count);
 *  4. else the template cut before its first missing placeholder (`New job offer JR-000012: {parcels} parcels …` → `New job offer JR-000012`);
 *  5. nothing usable left (or an unknown type) → the generic "You have a new update".
 */
export type NotifT = (key: string, vars?: Record<string, string | number>) => string;
export interface NotifLike { type: string; data?: unknown }

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const GENERIC = "ubz.notif_generic";
export const CITY_VARS = ["pickupCity", "deliveryCity"] as const;

export const placeholdersOf = (template: string): string[] => [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];

/** Placeholders a notification's `data` can supply: its scalar keys, `amount` (from `amountCents`) and the localized city names. */
export function notificationVars(t: NotifT, raw: unknown): Record<string, string> {
  const data = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null || typeof v === "object") continue;
    const s = String(v);
    if (s !== "") out[k] = s;
  }
  if (typeof data.amountCents === "number" && !("amount" in out)) out.amount = (data.amountCents / 100).toFixed(2);
  for (const k of CITY_VARS) {
    const key = out[k];
    if (key) { const name = t(`city.${key}`); out[k] = name.startsWith("city.") ? key : name; }
  }
  return out;
}

const fill = (template: string, vars: Record<string, string>) => template.replace(PLACEHOLDER, (m, k: string) => (k in vars ? vars[k] : m));

export function notificationText(t: NotifT, n: NotifLike): string {
  const vars = notificationVars(t, n.data);
  const key = `notif.${n.type}`;
  const raw = t(key);
  if (raw === key) return t(GENERIC); // a type this build has no text for
  const full = placeholdersOf(raw);
  if (full.every((p) => p in vars)) return fill(raw, vars);
  const shortKey = `${key}__short`, short = t(shortKey);
  if (short !== shortKey && placeholdersOf(short).every((p) => p in vars)) return fill(short, vars);
  const at = Math.min(...full.filter((p) => !(p in vars)).map((p) => raw.indexOf(`{${p}}`)));
  const head = fill(raw.slice(0, at), vars).replace(/[\s:：\-–—,،;؛.]+$/u, "");
  return head.length >= 3 && placeholdersOf(head).length === 0 ? head : t(GENERIC);
}
