import type { Locale } from "@/i18n/core";
import { fmtDate, fmtMoney, isoToRiyadhLocal, riyadhLocalToIso } from "@/lib/format";
import { ACTIVITY_KINDS, type ActivityEntity, type ActivityItem, type ActivityKind, type ActivityRef } from "@/server/activity-core";

/** Pure helpers of the shared activity log UI (`<ActivityLog>`): tones, day grouping, titles, links, URLs, diffs. */
type T = (k: string, v?: Record<string, string | number>) => string;
export type Tone = "accent" | "cyan" | "gold" | "danger" | "muted";
export const KINDS: readonly ActivityKind[] = ACTIVITY_KINDS;
export const KIND_TONE: Record<ActivityKind, Tone> = {
  event: "cyan", parcel: "accent", audit: "gold", chat: "cyan", notification: "muted", money: "accent", support: "gold", rating: "gold", note: "gold",
  document: "cyan", login: "muted", availability: "cyan", message: "muted", integration: "muted",
};
/** Full class names (Tailwind needs them spelled out): icon chip colours per tone. */
export const TONE_CLS: Record<Tone, string> = {
  accent: "bg-accent/10 text-accent", cyan: "bg-cyan/10 text-cyan", gold: "bg-gold/10 text-gold", danger: "bg-danger/10 text-danger", muted: "bg-line/50 text-muted",
};
const BAD = /(failed|rejected|dead_letter|otp_failed|cancel|missing|no_show|disputed|suspend|revoked|notify_failed|declined)/;
/** Problems stand out in red whatever their kind. */
export const itemTone = (it: Pick<ActivityItem, "kind" | "titleKey">): Tone => (BAD.test(it.titleKey.replace(/^.*\./, "")) ? "danger" : KIND_TONE[it.kind]);

// ───────── Days ─────────
/** Riyadh calendar day (YYYY-MM-DD) of a timestamp — the platform's "today". */
export const dayKey = (iso: string) => isoToRiyadhLocal(iso).slice(0, 10);
export function groupByDay<I extends { at: string }>(items: I[]): Array<{ day: string; items: I[] }> {
  const out: Array<{ day: string; items: I[] }> = [];
  for (const it of items) { const d = dayKey(it.at), g = out[out.length - 1]; if (g && g.day === d) g.items.push(it); else out.push({ day: d, items: [it] }); }
  return out;
}
export function dayLabel(day: string, t: T, locale: Locale, now = new Date()) {
  const today = dayKey(now.toISOString()), yesterday = dayKey(new Date(now.getTime() - 864e5).toISOString());
  return day === today ? t("ubz.today") : day === yesterday ? t("ubz.yesterday") : fmtDate(`${day}T12:00:00+03:00`, locale);
}

// ───────── Titles ─────────
const MONEY_KEYS = /Cents$/;
/** Everything a title may interpolate, formatted for the reader (amounts in SAR, failure reasons translated). Missing values show an em dash, never `{code}`. */
export function titleVars(it: Pick<ActivityItem, "params" | "titleKey">, t: T, locale: Locale): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(it.params ?? {})) {
    if (v == null || typeof v === "object") continue;
    if (MONEY_KEYS.test(k) && typeof v === "number") { out[k.replace(MONEY_KEYS, "") || "amount"] = fmtMoney(v, locale); out.amount = out.amount ?? fmtMoney(v, locale); continue; }
    out[k] = typeof v === "number" ? v : String(v);
  }
  const tryNs = (raw: string, ns: string[]) => { for (const n of ns) { const s = t(n + raw); if (s !== n + raw) return s; } return raw.replace(/_/g, " "); };
  for (const [k, ns] of [
    ["reason", ["stopfail.", "dtk.fail_", "dtk.revoke_", "dtk.reason_"]], ["why", ["stopfail.", "dtk.reason_"]], ["method", ["dtk.method_"]], ["source", ["dtk.src_"]], ["channel", ["dtk.channel_"]],
    ["direction", ["dtk.dir_"]], ["msgType", ["dtk.msg_"]], ["docType", ["doc."]], ["role", ["role."]], ["category", ["complaint_cat.", "ticket_cat."]],
  ] as const) { const raw = out[k]; if (typeof raw === "string" && raw) out[k] = tryNs(raw, [...ns]); }
  return out;
}
/** The title of one item in the viewer's language. Unknown keys fall back to a readable form of the key, so a new server event never shows as `dtk.x_y`. */
export function renderTitle(it: ActivityItem, t: T, locale: Locale): string {
  const vars = titleVars(it, t, locale);
  const raw = t(it.titleKey);
  if (raw === it.titleKey) return t(it.kind === "notification" ? "ubz.notif_generic" : "dtk.unknown_event", { event: it.titleKey.replace(/^[a-z]+\./, "").replace(/_/g, " ") });
  for (const name of raw.matchAll(/\{(\w+)\}/g)) if (!(name[1] in vars)) vars[name[1]] = "—";
  return t(it.titleKey, vars);
}

// ───────── Links ─────────
/** Where a reference leads in the admin app. One place to change when detail pages move. */
export function refHref(r: ActivityRef): string | null {
  switch (r.type) {
    case "request": return `/admin/requests/${r.id}`;
    case "ticket": return `/admin/cases/${r.id}`;
    case "complaint": return `/admin/complaints/${r.id}`;
    case "shipment": return r.id ? `/admin/parcels/${r.id}` : r.label ? `/admin/shipments?q=${encodeURIComponent(r.label)}` : null;
    case "settlement": return "/admin/finance/settlements";
    case "withdrawal": return "/admin/finance/withdrawals";
    case "company": return `/admin/companies/${r.id}`;
    case "driver": return `/admin/drivers/${r.id}`;
    case "office": return `/admin/offices/${r.id}`;
    case "user": return r.role === "business" ? `/admin/companies/${r.id}` : r.role === "driver" ? `/admin/drivers/${r.id}` : r.role === "office" ? `/admin/offices/${r.id}` : `/admin/users/${r.id}`;
    default: return null;
  }
}
export const refLabelKey = (r: ActivityRef) => `dtk.ref_${r.type}`;

// ───────── Requests ─────────
export interface Filters { kinds: string[]; q: string; actorId: string; from: string; to: string }
export const NO_FILTERS: Filters = { kinds: [], q: "", actorId: "", from: "", to: "" };
export const activeFilters = (f: Filters) => (f.kinds.length ? 1 : 0) + (f.q.trim() ? 1 : 0) + (f.actorId ? 1 : 0) + (f.from ? 1 : 0) + (f.to ? 1 : 0);
/** Query string of a feed request. Dates are Riyadh calendar days: `from` starts at 00:00, `to` includes the whole day. */
export function feedQuery(f: Filters, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  if (f.kinds.length) p.set("kinds", f.kinds.join(","));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.actorId) p.set("actorId", f.actorId);
  if (f.from) p.set("from", riyadhLocalToIso(`${f.from}T00:00`));
  if (f.to) p.set("to", riyadhLocalToIso(`${nextDay(f.to)}T00:00`));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
export const nextDay = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);
export const feedPath = (entity: ActivityEntity, id: string, f: Filters, page: number, pageSize: number) => `/admin/activity/${entity}/${id}${feedQuery(f, { page, pageSize })}`;
export const exportPath = (entity: ActivityEntity, id: string, f: Filters) => `/api/v1/admin/activity/${entity}/${id}/export${feedQuery(f)}`;

// ───────── Details ─────────
/** Audit entries store `{ field: { from, to } }`: those become before / after rows; any other shape returns null (show the JSON). */
export function diffRows(diff: unknown): Array<{ key: string; from: string; to: string }> | null {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;
  const entries = Object.entries(diff as Record<string, unknown>);
  const show = (v: unknown) => { const j = JSON.stringify(v); return j === undefined ? "—" : j.length > 120 ? `${j.slice(0, 117)}…` : j; };
  if (!entries.length || !entries.every(([, v]) => v && typeof v === "object" && !Array.isArray(v) && ("from" in (v as object) || "to" in (v as object)))) return null;
  return entries.map(([key, v]) => ({ key, from: show((v as { from?: unknown }).from), to: show((v as { to?: unknown }).to) }));
}
export const hasDetails = (d: unknown): boolean => d != null && (typeof d !== "object" || Object.keys(d as object).length > 0) && d !== "";
export const prettyJson = (d: unknown) => { try { return JSON.stringify(d, null, 2) ?? ""; } catch { return String(d); } };
/** Top-level scalars of an object as label / value pairs (what a support agent scans first); nested values are left to the JSON view. */
export function scalarRows(data: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> {
  return Object.entries(data ?? {}).filter(([, v]) => v != null && typeof v !== "object").map(([key, v]) => ({ key, value: String(v) }));
}
