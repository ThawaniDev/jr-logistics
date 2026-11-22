import { maskPhoneUsername } from "@/lib/username";
import { err } from "@/lib/errors";
import { isYmd, riyadhDay } from "./analytics/time";
import { presetRange, windowOf } from "./analytics/periods";

/**
 * Finance › Drivers (J7) — the pure part: the column catalogue (ONE list drives the SQL select, the row shaping, the sort whitelist, the CSV/Excel columns and the table on screen),
 * the period resolver and the row shaping. No database access here, so the browser may import it too.
 *
 * Money is integer halalas (`...Cents`), counts are integers, dates are ISO strings. Wallet columns are `null` for a driver who belongs to an office (`paidViaOffice`): his earnings are paid to the office.
 */
export type ColKind = "text" | "enum" | "money" | "int" | "date";
export type ColGroup = "identity" | "wallet" | "lifetime" | "withdrawals" | "cash" | "period" | "dates";
export interface FdCol {
  key: string; db: string; kind: ColKind; group: ColGroup;
  /** Dictionary namespace of an `enum` value (`city`, `status`). */
  ns?: string;
  /** On screen: shown as a table column (the export always has every column). */
  ui?: boolean;
  /** On screen: visible before the user changes the column picker. */
  on?: boolean;
  /** Counts shown as a muted second line under another column. */
  subOf?: string;
}
const c = (key: string, db: string, kind: ColKind, group: ColGroup, o: Partial<FdCol> = {}): FdCol => ({ key, db, kind, group, ui: true, ...o });

export const FD_COLS: FdCol[] = [
  c("name", "name", "text", "identity", { on: true }), c("username", "username", "text", "identity"), c("phone", "phone", "text", "identity"),
  c("city", "city", "enum", "identity", { ns: "city" }), c("status", "status", "enum", "identity", { ns: "status" }), c("verification", "verification", "enum", "identity", { ns: "status" }),
  c("officeName", "office_name", "text", "identity", { on: true }),
  c("walletAvailableCents", "wallet_available", "money", "wallet", { on: true }), c("walletHeldCents", "wallet_held", "money", "wallet"), c("walletPendingCents", "wallet_pending", "money", "wallet"),
  c("jobs", "jobs", "int", "lifetime"), c("delivered", "delivered", "int", "lifetime"), c("failed", "failed", "int", "lifetime"), c("returned", "returned", "int", "lifetime"),
  c("earnedCents", "earned", "money", "lifetime", { on: true }), c("paidCents", "paid", "money", "lifetime", { on: true }), c("pendingCents", "pending", "money", "lifetime", { on: true }),
  c("payoutFailedCents", "payout_failed", "money", "lifetime"), c("refundCents", "refund", "money", "lifetime"), c("adjustCents", "adjust", "money", "lifetime"),
  c("walletAdjustCents", "wallet_adjust", "money", "lifetime"), c("penaltiesCents", "penalties", "money", "lifetime"),
  c("wdRequestedCents", "wd_requested", "money", "withdrawals"), c("wdPaidCents", "wd_paid", "money", "withdrawals"), c("wdPendingCents", "wd_pending", "money", "withdrawals"), c("wdRejectedCents", "wd_rejected", "money", "withdrawals"),
  c("wdRequestedN", "wd_requested_n", "int", "withdrawals", { ui: false, subOf: "wdRequestedCents" }), c("wdPaidN", "wd_paid_n", "int", "withdrawals", { ui: false, subOf: "wdPaidCents" }),
  c("wdPendingN", "wd_pending_n", "int", "withdrawals", { ui: false, subOf: "wdPendingCents" }), c("wdRejectedN", "wd_rejected_n", "int", "withdrawals", { ui: false, subOf: "wdRejectedCents" }),
  c("cashCollectedCents", "cash_collected", "money", "cash"), c("cashRemittedCents", "cash_remitted", "money", "cash"), c("cashHeldCents", "cash_held", "money", "cash", { on: true }),
  c("periodJobs", "p_jobs", "int", "period"), c("periodParcels", "p_delivered", "int", "period"), c("periodEarnedCents", "p_earned", "money", "period", { on: true }), c("periodPaidCents", "p_paid", "money", "period"),
  c("periodCashCollectedCents", "p_cash_collected", "money", "period"), c("periodCashRemittedCents", "p_cash_remitted", "money", "period"),
  c("lastPayoutAt", "last_payout_at", "date", "dates", { on: true }), c("lastJobAt", "last_job_at", "date", "dates"),
];
export const FD_KEYS = FD_COLS.map((x) => x.key);
export const FD_BY_KEY = new Map(FD_COLS.map((x) => [x.key, x]));
export const WALLET_KEYS = FD_COLS.filter((x) => x.group === "wallet").map((x) => x.key);
/** Columns whose values add up in the totals row (money and counts; wallet columns skip drivers whose wallet is hidden). */
export const SUMMABLE = FD_COLS.filter((x) => x.kind === "money" || x.kind === "int");
export const FD_GROUPS: ColGroup[] = ["identity", "wallet", "lifetime", "withdrawals", "cash", "period", "dates"];
export const FD_DEFAULT_SORT = { key: "earnedCents", dir: "desc" as "asc" | "desc" };

export type FdRow = { id: string; officeId: string | null; independent: boolean; paidViaOffice: boolean } & Record<string, string | number | boolean | null>;

const numOrNull = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (v: unknown): string | null => { if (v == null) return null; const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
export const maskPhone = (p: string | null): string | null => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);

/** One SQL record (snake_case) → the API row. `sensitive` = the viewer may see phone numbers (`drivers.sensitive`). Wallet columns are `null` for a driver paid through an office. */
export function shapeRow(rec: Record<string, unknown>, sensitive: boolean): FdRow {
  const viaOffice = rec.via_office === true || rec.via_office === "t";
  const row: FdRow = { id: String(rec.id), officeId: rec.office_id ? String(rec.office_id) : null, independent: !rec.office_id, paidViaOffice: viaOffice };
  for (const col of FD_COLS) {
    const v = rec[col.db];
    row[col.key] = col.kind === "money" ? numOrNull(v) : col.kind === "int" ? (numOrNull(v) ?? 0) : col.kind === "date" ? iso(v) : v == null ? null : String(v);
  }
  if (viaOffice) for (const k of WALLET_KEYS) row[k] = null;
  if (!sensitive) { row.phone = maskPhone(row.phone as string | null); row.username = maskPhoneUsername(row.username as string | null) ?? null; } // a username that is the phone number is the phone number
  return row;
}

/** The totals row: the sums of the summable columns over every driver of the selection (the SQL gives them under the same keys). */
export function shapeTotals(rec: Record<string, unknown> | undefined): Record<string, number> & { drivers: number } {
  const out: Record<string, number> = { drivers: numOrNull(rec?.n) ?? 0 };
  for (const col of SUMMABLE) out[col.key] = numOrNull(rec?.[col.db]) ?? 0;
  return out as Record<string, number> & { drivers: number };
}

// ───────── sorting, paging, filters ─────────
export interface SortSpec { key: string; dir: "asc" | "desc" }
export function sortOf(query: URLSearchParams): SortSpec {
  const key = query.get("sort") ?? FD_DEFAULT_SORT.key, dir = query.get("dir") ?? FD_DEFAULT_SORT.dir;
  if (!FD_BY_KEY.has(key)) throw err("VALIDATION", "Unknown sort column", { field: "sort" });
  if (dir !== "asc" && dir !== "desc") throw err("VALIDATION", "dir must be asc or desc", { field: "dir" });
  return { key, dir };
}
export function intParam(query: URLSearchParams, key: string, def: number, min: number, max: number): number {
  const raw = query.get(key);
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw err("VALIDATION", `${key} must be a whole number between ${min} and ${max}`, { field: key });
  return n;
}
export const MAX_PAGE_SIZE = 100;

export interface FdFilters { q: string; office: string; city: string; status: string; hasCash: boolean; hasPending: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function filtersOf(query: URLSearchParams): FdFilters {
  const q = (query.get("q") ?? "").trim().slice(0, 80), office = query.get("office") ?? "", city = (query.get("city") ?? "").trim(), status = query.get("status") ?? "";
  if (office && office !== "independent" && !UUID.test(office)) throw err("VALIDATION", "office must be an office id or \"independent\"", { field: "office" });
  if (city && !/^[^\s,]{2,40}$/.test(city)) throw err("VALIDATION", "Not a valid city key", { field: "city" });
  if (status && status !== "active" && status !== "suspended") throw err("VALIDATION", "status must be active or suspended", { field: "status" });
  return { q, office, city, status, hasCash: query.get("hasCash") === "1", hasPending: query.get("hasPending") === "1" };
}

// ───────── period ─────────
export interface Period { mode: "range" | "all"; from: string | null; to: string | null; days: number | null; start: Date | null; end: Date | null; isDefault: boolean }
/** `from` + `to` (YYYY-MM-DD, Riyadh days, inclusive), or `period=all`, or — with none of them — the last 30 days. At most 5 years; one without the other is refused. */
export const MAX_PERIOD_DAYS = 1830;
export function resolvePeriod(query: URLSearchParams, now: Date = new Date()): Period {
  const from = query.get("from") ?? "", to = query.get("to") ?? "";
  if (query.get("period") === "all" && !from && !to) return { mode: "all", from: null, to: null, days: null, start: null, end: null, isDefault: false };
  if (!from && !to) { const r = presetRange("30d", riyadhDay(now)); const w = windowOf(r.from, r.to); return { mode: "range", from: w.from, to: w.to, days: w.days, start: w.start, end: w.end, isDefault: true }; }
  if (!from || !to) throw err("VALIDATION", "Give both from and to (YYYY-MM-DD)", { field: from ? "to" : "from" });
  for (const [k, v] of [["from", from], ["to", to]] as const) if (!isYmd(v) || v < "2000-01-01" || v > "2100-12-31") throw err("VALIDATION", "Use YYYY-MM-DD", { field: k });
  if (from > to) throw err("VALIDATION", "from must not be after to", { field: "from" });
  const w = windowOf(from, to);
  if (w.days > MAX_PERIOD_DAYS) throw err("VALIDATION", `The period is at most ${MAX_PERIOD_DAYS} days`, { field: "to" });
  return { mode: "range", from: w.from, to: w.to, days: w.days, start: w.start, end: w.end, isDefault: false };
}

/** The dictionary key naming one statement row's type (`ledger.payout`, `fdr.st_earned` …); shared by the screen and the export. */
export function statementTypeKey(source: string, kind: string): string {
  if (source === "wallet") return `ledger.${kind}`;
  if (source === "settlement") return "fdr.st_earned";
  return source === "cod_collected" ? "fdr.st_cod_collected" : "fdr.st_cod_remitted";
}
/** Ledger kinds a wallet entry can have (the ledger filter). */
export const LEDGER_KINDS = ["topup", "reserve", "release_reserve", "charge", "refund", "payout", "platform_fee", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment"] as const;
/** The kinds of row a statement has (the filter of the Statement tab). */
export const STATEMENT_SOURCES = ["settlement", "wallet", "cod_collected", "cod_remitted"] as const;
