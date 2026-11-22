import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/core";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { Bucket } from "@/server/analytics/periods";
import { addDays } from "@/server/analytics/time";

/**
 * Chart look + number formatting for every report. Colours come ONLY from the design tokens: `chartVars` defines `--rpf-c1…c8` on the element that wraps charts
 * (ReportShell and every chart frame apply it), the four brand tokens first and four hue-rotated variants of them after (same lightness and chroma as the token,
 * so they stay readable on the card in both themes: tests/unit/theme-contrast.test.ts checks every series colour for ≥ 3:1 against the card in dark and in light). Neighbouring series differ in hue AND lightness, and every chart also has a table view, so colour is never the only channel.
 */
export const chartVars = {
  "--rpf-c1": "var(--jr-accent)",
  "--rpf-c2": "var(--jr-gold)",
  "--rpf-c3": "oklch(from var(--jr-accent) l c calc(h + 130))",
  "--rpf-c4": "var(--jr-danger)",
  "--rpf-c5": "var(--jr-cyan)",
  "--rpf-c6": "oklch(from var(--jr-gold) l c calc(h + 150))",
  "--rpf-c7": "oklch(from var(--jr-danger) l c calc(h + 330))",
  "--rpf-c8": "var(--jr-muted)",
} as CSSProperties;
export const PALETTE_SIZE = 8;
/** The colour of series `i` (wraps after 8). */
export const seriesColor = (i: number) => `var(--rpf-c${(i % PALETTE_SIZE) + 1})`;
/** Fixed colours for the statuses that appear in several charts, so "cancelled" is the same colour everywhere. */
export const STATUS_COLOR: Record<string, string> = {
  completed: seriesColor(0), delivered: seriesColor(0), active: seriesColor(4), cancelled: seriesColor(3), failed: seriesColor(3), expired: seriesColor(7), returned: seriesColor(1),
  gmv: seriesColor(0), revenue: seriesColor(4),
};
export const AXIS = { tick: { fill: "var(--jr-muted)", fontSize: 11 }, stroke: "var(--jr-line)" } as const;

/** How a value is shown. `count` is the KPI unit name for `number`. */
export type ValueFormat = "number" | "count" | "money" | "percent" | "duration" | "rate";
const tag = (l: Locale) => (l === "en" ? "en-GB" : l === "ur" ? "ur-PK-u-nu-latn" : "ar-SA-u-nu-latn-ca-gregory");
const nf = new Map<string, Intl.NumberFormat>();
const numFmt = (l: Locale, o: Intl.NumberFormatOptions) => { const k = l + JSON.stringify(o); let f = nf.get(k); if (!f) { f = new Intl.NumberFormat(tag(l), o); nf.set(k, f); } return f; };

export const fmtCompact = (n: number, l: Locale) => numFmt(l, { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const fmtPercent = (frac: number, l: Locale, digits = 1) => numFmt(l, { style: "percent", maximumFractionDigits: digits }).format(frac);
export const fmtRate = (n: number, l: Locale) => numFmt(l, { maximumFractionDigits: 1 }).format(n);
/** Seconds as `45 s`, `12 min`, `3 h 20 min`, `2 d 4 h` (units in the viewer's language). */
export function fmtDur(sec: number, l: Locale): string {
  const u = l === "en" ? { s: "s", m: "min", h: "h", d: "d" } : l === "ur" ? { s: "سیکنڈ", m: "منٹ", h: "گھنٹے", d: "دن" } : { s: "ث", m: "د", h: "س", d: "ي" };
  const n = (x: number) => fmtNum(x, l);
  if (sec < 60) return `${n(Math.round(sec))} ${u.s}`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${n(m)} ${u.m}`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${n(h)} ${u.h} ${n(m % 60)} ${u.m}` : `${n(h)} ${u.h}`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${n(d)} ${u.d} ${n(h % 24)} ${u.h}` : `${n(d)} ${u.d}`;
}
/** `SAR 1.2M`: money in halalas, compact (for cards and axes that need the currency). */
export const fmtMoneyCompact = (cents: number, l: Locale) => numFmt(l, { style: "currency", currency: "SAR", currencyDisplay: l === "en" ? "code" : "symbol", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
/** One formatter for a value kind: money is halalas → SAR. `compact` is for axes and tiny labels. */
export function formatValue(v: number | null | undefined, kind: ValueFormat, l: Locale, compact = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (kind) {
    case "money": return compact ? fmtCompact(v / 100, l) : fmtMoney(v, l);
    case "percent": return fmtPercent(v, l, compact ? 0 : 1);
    case "duration": return fmtDur(v, l);
    case "rate": return fmtRate(v, l);
    default: return compact ? fmtCompact(v, l) : fmtNum(v, l);
  }
}
/** `+12.3%` / `−4%`: a relative change. */
export const fmtSignedPct = (frac: number, l: Locale) => `${frac > 0 ? "+" : frac < 0 ? "−" : ""}${numFmt(l, { style: "percent", maximumFractionDigits: 1 }).format(Math.abs(frac))}`;
/** `+2.1` / `−0.4`: a change in percentage points (input is the difference of two fractions). */
export const fmtSignedPp = (frac: number, l: Locale) => `${frac > 0 ? "+" : frac < 0 ? "−" : ""}${numFmt(l, { maximumFractionDigits: 1 }).format(Math.abs(frac * 100))}`;

const utc = (key: string) => new Date(`${key.slice(0, 10)}T${key.length > 10 ? key.slice(11, 13) : "00"}:00:00Z`);
/**
 * Axis / tooltip text for a bucket key from the server. Keys are Riyadh wall-clock, so they are formatted as UTC (no time-zone shift).
 * Short: `19 Nov`, `14:00`, `Nov 26`; long adds the year, the weekday-less date range of a week, or the hour's date.
 */
export function bucketLabel(key: string, bucket: Bucket, l: Locale, long = false): string {
  const f = (o: Intl.DateTimeFormatOptions, d = utc(key)) => new Intl.DateTimeFormat(tag(l), { ...o, timeZone: "UTC" }).format(d);
  switch (bucket) {
    case "hour": return long ? f({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : f({ hour: "2-digit", minute: "2-digit", hour12: false });
    case "day": return f(long ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
    case "week": return long ? `${f({ day: "numeric", month: "short" })} – ${f({ day: "numeric", month: "short", year: "numeric" }, utc(addDays(key, 6)))}` : f({ day: "numeric", month: "short" });
    case "month": return f(long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });
  }
}
