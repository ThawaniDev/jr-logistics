/**
 * Pure helpers for the staff console field-operations screens (decisions E1–E18): coordinates, per-warehouse tri-state switches,
 * platform settings patch, cash-on-delivery amounts, finance history badges and support attachments.
 * No React, no I/O — unit-tested in tests/unit/admin-fieldops.test.ts.
 */

// ───────────────────────── Coordinates ─────────────────────────

/** Arabic-Indic / Persian digits and punctuation → ASCII, so a pasted "٢٤٫٧١٣٦، ٤٦٫٦٧٥٣" still parses. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".").replace(/[،؛]/g, ",");
}

export interface LatLng { lat: number; lng: number }
export const validLatLng = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PAIR_IN_URL = [
  new RegExp(`!3d${NUM}!4d${NUM}`),                                             // the pin itself (preferred over the map viewport)
  new RegExp(`@${NUM},\\s*${NUM}`),                                             // …/@24.71,46.67,17z
  new RegExp(`[?&](?:q|query|ll|center|destination|daddr|saddr|sll)=\\s*${NUM}\\s*,\\s*${NUM}`, "i"),
  new RegExp(`geo:${NUM},\\s*${NUM}`, "i"),
];
const PLAIN = new RegExp(`^${NUM}\\s*°?\\s*([NS])?\\s*[,;\\s]\\s*${NUM}\\s*°?\\s*([EW])?$`, "i");

/**
 * Reads a map pin from what a person pastes: "24.7136, 46.6753", "24.7136 46.6753", "24.7136° N, 46.6753° E",
 * a Google Maps URL (`/@lat,lng`, `!3dlat!4dlng`, `?q=lat,lng`) or a `geo:` link. Short links (maps.app.goo.gl) carry no coordinates → null.
 */
export function parseCoordinates(input: string): LatLng | null {
  let s = normalizeDigits(String(input ?? "")).trim();
  if (!s) return null;
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  const done = (lat: number, lng: number) => (validLatLng(lat, lng) ? { lat, lng } : null);
  for (const re of PAIR_IN_URL) { const m = re.exec(s); if (m) return done(Number(m[1]), Number(m[2])); }
  const m = PLAIN.exec(s);
  if (m) return done(Number(m[1]) * (m[2]?.toUpperCase() === "S" ? -1 : 1), Number(m[3]) * (m[4]?.toUpperCase() === "W" ? -1 : 1));
  return null;
}

/** Parses one coordinate text box (accepts a plain number, or a pasted pair — the caller decides what to do with a pair). */
export function parseOneCoord(input: string): number | null {
  const s = normalizeDigits(String(input ?? "")).trim().replace(/°$/, "");
  if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
export const fmtCoord = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(Math.round(n * 1e6) / 1e6));

// ───────────────────────── Per-warehouse switches (tri-state) ─────────────────────────

export const WAREHOUSE_SWITCHES = ["requireArrivalConfirmation", "requireLoadingRecord", "requireDeliveryOtp", "requireSignature"] as const;
export type WarehouseSwitch = (typeof WAREHOUSE_SWITCHES)[number];
export type Tri = "inherit" | "on" | "off";
export type Overrides = Partial<Record<WarehouseSwitch, boolean | null>>;
export type Defaults = Partial<Record<WarehouseSwitch, boolean>>;

/** Platform defaults when the settings object predates E.0 (match the server defaults). */
export const WAREHOUSE_DEFAULTS_FALLBACK: Record<WarehouseSwitch, boolean> = { requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false };

export const triFromOverride = (v: boolean | null | undefined): Tri => (v === true ? "on" : v === false ? "off" : "inherit");
export const overrideFromTri = (t: Tri): boolean | null => (t === "on" ? true : t === "off" ? false : null);
/** The value that applies given the selection and the platform default. */
export const effectiveOf = (tri: Tri, platformDefault: boolean): boolean => (tri === "inherit" ? platformDefault : tri === "on");

export interface WarehouseData { lat?: number | null; lng?: number | null; ops?: Defaults; overrides?: Overrides; defaults?: Defaults }
export interface WarehouseForm { lat: string; lng: string; ops: Record<WarehouseSwitch, Tri> }

export function warehouseFormFrom(d: WarehouseData | null | undefined): WarehouseForm {
  return {
    lat: fmtCoord(d?.lat), lng: fmtCoord(d?.lng),
    ops: Object.fromEntries(WAREHOUSE_SWITCHES.map((k) => [k, triFromOverride(d?.overrides?.[k])])) as Record<WarehouseSwitch, Tri>,
  };
}

export type WarehouseProblem = "coords_pair" | "coords_invalid";
export interface WarehousePatch { lat?: number; lng?: number; ops?: Partial<Record<WarehouseSwitch, boolean | null>> }

/**
 * Builds the PATCH body from the form: only what changed (location as a pair, switches that differ from the stored override).
 * A half-filled or out-of-range location is a problem; leaving both boxes empty means "no change" (the API cannot clear a pin).
 */
export function buildWarehousePatch(data: WarehouseData | null | undefined, form: WarehouseForm): { patch: WarehousePatch; problem?: WarehouseProblem } {
  const patch: WarehousePatch = {};
  const latT = form.lat.trim(), lngT = form.lng.trim();
  if (latT || lngT) {
    if (!latT || !lngT) return { patch, problem: "coords_pair" };
    const lat = parseOneCoord(latT), lng = parseOneCoord(lngT);
    if (lat === null || lng === null || !validLatLng(lat, lng)) return { patch, problem: "coords_invalid" };
    if (lat !== (data?.lat ?? null) || lng !== (data?.lng ?? null)) { patch.lat = lat; patch.lng = lng; }
  }
  const ops: Partial<Record<WarehouseSwitch, boolean | null>> = {};
  for (const k of WAREHOUSE_SWITCHES) {
    const next = overrideFromTri(form.ops[k]); const prev = data?.overrides?.[k] ?? null;
    if (next !== prev) ops[k] = next;
  }
  if (Object.keys(ops).length) patch.ops = ops;
  return { patch };
}
export const isEmptyPatch = (p: WarehousePatch) => Object.keys(p).length === 0;

// ───────────────────────── Platform settings (E.0) ─────────────────────────

export const FIELDOPS_BOOL_KEYS = ["arrivalGeofenceEnabled", "driverCanReorderRoute", "rescheduleEvidenceText", "rescheduleEvidencePhoto", "driverSingleActiveJob", "stopFailStrictRules", "routingEnabled", "b2bShipmentsEnabled"] as const;
export const FIELDOPS_NUM_KEYS = ["arrivalRadiusM", "stopWaitMin"] as const;
export const FIELDOPS_RANGE: Record<(typeof FIELDOPS_NUM_KEYS)[number], [number, number]> = { arrivalRadiusM: [20, 5000], stopWaitMin: [0, 120] };
/** Server defaults (E.0) — shown when the settings object has no value yet. */
export interface FieldopsSettings {
  arrivalGeofenceEnabled: boolean; arrivalRadiusM: number; driverCanReorderRoute: boolean; rescheduleEvidenceText: boolean; rescheduleEvidencePhoto: boolean;
  stopWaitMin: number; driverSingleActiveJob: boolean; stopFailStrictRules: boolean; warehouseDefaults: Record<WarehouseSwitch, boolean>;
  /** Update J: route planning + one-stop-at-a-time (J2) and business-type recipients (J3). Both are OFF until a super admin switches them on. */
  routingEnabled: boolean; b2bShipmentsEnabled: boolean;
}
export const FIELDOPS_DEFAULTS: FieldopsSettings = {
  arrivalGeofenceEnabled: true, arrivalRadiusM: 200, driverCanReorderRoute: true, rescheduleEvidenceText: true, rescheduleEvidencePhoto: true,
  stopWaitMin: 0, driverSingleActiveJob: true, stopFailStrictRules: false, warehouseDefaults: WAREHOUSE_DEFAULTS_FALLBACK, routingEnabled: false, b2bShipmentsEnabled: false,
};
export const FIELDOPS_KEYS = [...FIELDOPS_BOOL_KEYS, ...FIELDOPS_NUM_KEYS, "warehouseDefaults"] as const;
/** Legacy keys the form always re-sends (the existing save pattern). `stopWaitMin`, `settlementPeriod` and `separationOfDuties` are intentionally absent. */
export const LEGACY_SETTINGS_KEYS = ["enabledServices", "vatPct", "cancelPolicyEnabled", "cancelWarnAt", "cancelSuspendAt", "cancelWindowDays", "cancelSuspendDays", "lateGraceMin", "checkinEarlyMin", "overlapPolicy", "requireBusinessVerification", "requireDriverVerification", "requireStaffMfa", "minWithdrawalCents", "termsVersion", "termsBusiness", "termsDriver", "termsOffice", "cities"] as const;

/** A whole number inside the range, or null (empty, fractional, out of range). Accepts typed text or a number. */
export function intInRange(v: unknown, min: number, max: number): number | null {
  const s = normalizeDigits(String(v ?? "")).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Field-level problems of the unsaved field-operations edits (only fields the user touched are checked). */
export function fieldopsErrors(edits: Record<string, unknown>): Partial<Record<(typeof FIELDOPS_NUM_KEYS)[number], "range">> {
  const out: Partial<Record<(typeof FIELDOPS_NUM_KEYS)[number], "range">> = {};
  for (const k of FIELDOPS_NUM_KEYS) if (k in edits && intInRange(edits[k], ...FIELDOPS_RANGE[k]) === null) out[k] = "range";
  return out;
}

/** Effective value of a field-operations key: the unsaved edit, else the server value, else the platform default. */
export function settingValue<K extends keyof FieldopsSettings>(server: Record<string, unknown> | null | undefined, edits: Record<string, unknown>, key: K): FieldopsSettings[K] {
  if (key in edits) return edits[key] as FieldopsSettings[K];
  const v = server?.[key];
  return (v === undefined || v === null ? FIELDOPS_DEFAULTS[key] : v) as FieldopsSettings[K];
}
export function warehouseDefaultsOf(server: Record<string, unknown> | null | undefined, edits: Record<string, unknown>): Record<WarehouseSwitch, boolean> {
  const base = { ...WAREHOUSE_DEFAULTS_FALLBACK, ...((server?.warehouseDefaults as Defaults | undefined) ?? {}), ...((edits.warehouseDefaults as Defaults | undefined) ?? {}) };
  return Object.fromEntries(WAREHOUSE_SWITCHES.map((k) => [k, !!base[k]])) as Record<WarehouseSwitch, boolean>;
}

/**
 * PATCH /admin/settings body: the legacy keys exactly as before, plus the field-operations keys **only when they changed** from the stored value.
 * `merged` is the server copy overlaid with the unsaved edits (what the form shows).
 */
export function buildSettingsPatch(server: Record<string, unknown>, edits: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...server, ...edits };
  const patch: Record<string, unknown> = Object.fromEntries(LEGACY_SETTINGS_KEYS.map((k) => [k, merged[k]]));
  for (const k of FIELDOPS_BOOL_KEYS) {
    if (!(k in edits)) continue;
    if (!!edits[k] !== settingValue(server, {}, k)) patch[k] = !!edits[k];
  }
  for (const k of FIELDOPS_NUM_KEYS) {
    if (!(k in edits)) continue;
    const n = intInRange(edits[k], ...FIELDOPS_RANGE[k]);
    if (n !== null && n !== settingValue(server, {}, k)) patch[k] = n;
  }
  if ("warehouseDefaults" in edits) {
    const next = warehouseDefaultsOf(server, edits); const prev = warehouseDefaultsOf(server, {});
    if (WAREHOUSE_SWITCHES.some((k) => next[k] !== prev[k])) patch.warehouseDefaults = next;
  }
  return patch;
}

// ───────────────────────── Cash on delivery ─────────────────────────

/** "123.45" / "123,45" / "١٢٣٫٤٥" (SAR) → integer halalas without float drift; null when not a positive amount with ≤ 2 decimals. */
export function parseSarToCents(input: string): number | null {
  const s = normalizeDigits(String(input ?? "")).trim().replace(/\s/g, "").replace(",", ".");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return cents > 0 ? cents : null;
}
export const centsToSarText = (c: number) => (c / 100).toFixed(2);

export type ReceiveProblem = "invalid" | "max";
/** Validates the amount typed in "Receive money": > 0 and ≤ what is outstanding on that order. */
export function checkReceiveAmount(text: string, outstandingCents: number): { cents: number | null; problem?: ReceiveProblem } {
  const cents = parseSarToCents(text);
  if (cents === null) return { cents: null, problem: "invalid" };
  if (cents > outstandingCents) return { cents, problem: "max" };
  return { cents };
}
/** `422 VALIDATION field=amountCents details.max` → the maximum in halalas, else null. */
export function receiveMaxFrom(details: unknown): number | null {
  const d = (details ?? {}) as { field?: unknown; max?: unknown };
  if (d.field !== undefined && d.field !== "amountCents") return null;
  if (d.max === undefined || d.max === null || d.max === "") return null;
  const n = Number(d.max);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface CodRow { offerId: string; requestId?: string; ref: string; businessId: string; businessName: string; driverId: string; driverName: string; collectedCents: number; receivedCents: number; outstandingCents: number }
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
export const uniqueWarehouses = (rows: CodRow[]) => [...new Map(rows.map((r) => [r.businessId, { id: r.businessId, name: r.businessName }])).values()].sort(byName);
export const driversOf = (rows: CodRow[], businessId: string) => [...new Map(rows.filter((r) => !businessId || r.businessId === businessId).map((r) => [r.driverId, { id: r.driverId, name: r.driverName }])).values()].sort(byName);
export const ordersOf = (rows: CodRow[], businessId: string, driverId: string) => rows.filter((r) => r.businessId === businessId && r.driverId === driverId);
/** The rows the warehouse / driver / search filters leave (search = order ref, driver or warehouse name, like the server), and how many of them still have cash outstanding. */
export function scopeCodRows(rows: CodRow[], f: { businessId?: string; driverId?: string; q?: string }) {
  const needle = (f.q ?? "").trim().toLowerCase();
  const scoped = rows.filter((r) => (!f.businessId || r.businessId === f.businessId) && (!f.driverId || r.driverId === f.driverId)
    && (!needle || [r.ref, r.driverName, r.businessName].some((v) => (v ?? "").toLowerCase().includes(needle))));
  return { rows: scoped, outstanding: scoped.filter((r) => r.outstandingCents > 0).length, all: scoped.length };
}

// ───────────────────────── Finance history (E18) ─────────────────────────

export type SettleKind = "paid" | "hold" | "legacy";
/** `paid`; `approved` (or a flagged hold) = waiting on an open complaint; everything else is a legacy state shown neutrally. */
export function settlementKind(x: { status?: string; held?: boolean }): SettleKind {
  if (x.status === "paid") return "paid";
  if (x.status === "approved" || (x.held && x.status !== "paid")) return "hold";
  return "legacy";
}
/** Filter tabs of the history: only the two states that exist now. `status` is sent to the API as-is. */
export const SETTLE_FILTERS = ["", "paid", "approved"] as const;

// ───────────────────────── Support attachments & filters ─────────────────────────

export type AttachmentKind = "image" | "pdf" | "file";
export function attachmentKind(mime: string | null | undefined): AttachmentKind {
  const m = String(mime ?? "").toLowerCase();
  if (m === "image/jpeg" || m === "image/png" || m === "image/webp") return "image";
  if (m === "application/pdf") return "pdf";
  return "file";
}
export const attachmentUrl = (id: string) => `/api/v1/tickets/attachments/${encodeURIComponent(id)}`;
export function fmtBytes(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${Math.round(v / 102.4) / 10} KB`;
  return `${Math.round(v / 104857.6) / 10} MB`;
}
export const TICKET_UPLOAD_MAX = 3;
export const TICKET_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const TICKET_UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** null when the file may be uploaded, else why not. */
export function ticketFileProblem(f: { size: number; type: string }): "type" | "size" | null {
  if (!TICKET_UPLOAD_MIME.includes(f.type)) return "type";
  if (f.size > TICKET_UPLOAD_MAX_BYTES) return "size";
  return null;
}

/** Role-of-opener filter applied on the client as well, so it works even before the API supports it. */
export function filterByOpenerRole<T extends { openedByRole?: string | null }>(items: T[], role: string): T[] {
  return role ? items.filter((x) => x.openedByRole === role) : items;
}

export interface TicketPatch { status?: "open" | "in_review" | "resolved"; priority?: "normal" | "urgent"; assignTo?: string | null; assignToMe?: boolean }
/** Builds the PATCH body for one change in the ticket controls; null when nothing would change. */
export function ticketPatch(ticket: { status?: string; priority?: string; assignedTo?: string | null }, change: { status?: string; priority?: string; assignedTo?: string | null; assignToMe?: boolean }): TicketPatch | null {
  const p: TicketPatch = {};
  if (change.status !== undefined && change.status !== ticket.status && ["open", "in_review", "resolved"].includes(change.status)) p.status = change.status as TicketPatch["status"];
  if (change.priority !== undefined && change.priority !== ticket.priority && ["normal", "urgent"].includes(change.priority)) p.priority = change.priority as TicketPatch["priority"];
  if (change.assignToMe) p.assignToMe = true;
  else if (change.assignedTo !== undefined && (change.assignedTo || null) !== (ticket.assignedTo ?? null)) p.assignTo = change.assignedTo || null;
  return Object.keys(p).length ? p : null;
}
