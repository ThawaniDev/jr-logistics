/**
 * Pure helpers of the warehouse-side field-operations screens (decisions E1, E15, E17): coordinates / Google Maps links, SAR ↔ halalas,
 * cash-on-delivery maths, support attachments. No React, no network — covered by tests/unit/business-fieldops.test.ts.
 */

// ───────── Digits and numbers typed in any of the three languages ─────────
const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};
/** Arabic-Indic and Persian/Urdu digits → ASCII; Arabic decimal/thousands/list separators → . , , ; invisible direction marks removed. */
export function normalizeDigits(s: string): string {
  return String(s ?? "")
    .replace(/[٠-٩۰-۹]/g, (c) => DIGIT_MAP[c] ?? c)
    .replace(/٫/g, ".").replace(/٬/g, ",").replace(/،/g, ",").replace(/؛/g, ";")
    .replace(/[‎‏‪-‮⁦-⁩ ]/g, " ");
}

// ───────── Warehouse location (E1) ─────────
export interface LatLng { lat: number; lng: number }
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const NUM = "[-+]?\\d{1,3}(?:\\.\\d+)?";

/** One typed coordinate ("24.7136", "24,7136", " ٢٤٫٧ ") → number, or null. */
export function parseCoordinate(v: string): number | null {
  let s = normalizeDigits(v).trim().replace(/°/g, "");
  if (!s) return null;
  if (s.includes(",") && !s.includes(".") && s.split(",").length === 2) s = s.replace(",", ".");
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Latitude / longitude boxes → numbers (6 decimals) or the i18n key of each problem. */
export function validateLatLng(latText: string, lngText: string): { ok: boolean; lat?: number; lng?: number; errors: { lat?: string; lng?: string } } {
  const errors: { lat?: string; lng?: string } = {};
  const lat = parseCoordinate(latText), lng = parseCoordinate(lngText);
  if (!latText.trim()) errors.lat = "val.required"; else if (lat == null || Math.abs(lat) > 90) errors.lat = "fob.val_lat";
  if (!lngText.trim()) errors.lng = "val.required"; else if (lng == null || Math.abs(lng) > 180) errors.lng = "fob.val_lng";
  if (errors.lat || errors.lng) return { ok: false, errors };
  return { ok: true, lat: round6(lat as number), lng: round6(lng as number), errors };
}

/** "24.7136,46.6753" — the shape both the inputs and the "View on map" link use. */
export const formatLatLng = (lat: number, lng: number) => `${round6(lat)}, ${round6(lng)}`;
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${round6(lat)},${round6(lng)}`;

/** `maps.app.goo.gl/…`, `goo.gl/maps/…`, `g.co/kgs/…`: the pin is behind a redirect the browser cannot read for us. */
export const isShortMapsLink = (text: string) => /(?:^|[\s/])(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/|g\.page\/)/i.test(text.trim());

const DMS = new RegExp(`(\\d{1,3})\\s*°\\s*(\\d{1,2})\\s*['′’]\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*(?:["″”]|'')?\\s*([NSEW])`, "gi");
function dmsPair(text: string): LatLng | null {
  const hits = [...text.matchAll(DMS)];
  if (hits.length < 2) return null;
  const val = (m: RegExpMatchArray) => { const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600; return /[SW]/i.test(m[4]) ? -v : v; };
  const a = hits[0], b = hits[1];
  const latHit = /[NS]/i.test(a[4]) ? a : /[NS]/i.test(b[4]) ? b : null, lngHit = /[EW]/i.test(a[4]) ? a : /[EW]/i.test(b[4]) ? b : null;
  if (!latHit || !lngHit || latHit === lngHit) return null;
  const lat = val(latHit), lng = val(lngHit);
  return inRange(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
}

function pairFrom(a: string, b: string): LatLng | null {
  const lat = Number(a), lng = Number(b);
  return inRange(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
}

/**
 * Reads a point out of whatever a warehouse owner pastes:
 *  · "24.7136, 46.6753" (comma, semicolon or space; Arabic digits too) · degrees-minutes-seconds ("24°42'49"N 46°40'31"E")
 *  · Google Maps links: `…/@24.71,46.67,15z`, `…/place/…!3d24.71!4d46.67` (the pin wins over the map centre), `?q=` / `?ll=` / `?query=` / `?center=` / `?daddr=`
 *  · OpenStreetMap / Apple Maps links.
 * Returns null when nothing usable is found (short `maps.app.goo.gl` links need `isShortMapsLink`).
 */
export function parseCoordinates(input: string): LatLng | null {
  let text = normalizeDigits(input).trim();
  if (!text) return null;
  try { text = decodeURIComponent(text.replace(/\+/g, " ")); } catch { /* keep as typed */ }
  // 1. the exact pin of a place page
  let m = new RegExp(`!3d(${NUM})!4d(${NUM})`).exec(text);
  if (m) { const p = pairFrom(m[1], m[2]); if (p) return p; }
  // 2. query parameters (also inside the fragment of OSM links)
  for (const key of ["q", "ll", "query", "center", "daddr", "destination", "sll", "saddr", "origin"]) {
    m = new RegExp(`[?&#]${key}=(?:loc:|@)?\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})`, "i").exec(text);
    if (m) { const p = pairFrom(m[1], m[2]); if (p) return p; }
  }
  m = new RegExp(`[?&#]mlat=(${NUM})&(?:amp;)?mlon=(${NUM})`, "i").exec(text);
  if (m) { const p = pairFrom(m[1], m[2]); if (p) return p; }
  // 3. the map centre of the link
  m = new RegExp(`/@(${NUM}),(${NUM})`).exec(text);
  if (m) { const p = pairFrom(m[1], m[2]); if (p) return p; }
  m = new RegExp(`#map=\\d+(?:\\.\\d+)?/(${NUM})/(${NUM})`).exec(text);
  if (m) { const p = pairFrom(m[1], m[2]); if (p) return p; }
  // 4. degrees-minutes-seconds anywhere in the text
  const dms = dmsPair(text);
  if (dms) return dms;
  // 5. a bare pair
  m = new RegExp(`^\\(?\\s*(${NUM})\\s*°?\\s*[NnEe]?\\s*[,;\\s]\\s*(${NUM})\\s*°?\\s*[NnEe]?\\s*\\)?$`).exec(text);
  if (m) return pairFrom(m[1], m[2]);
  return null;
}

// ───────── Money: SAR typed by people ↔ integer halalas ─────────
/** Server limit of one parcel's cash on delivery (SAR 100 000). */
export const COD_MAX_CENTS = 10_000_000;
const CURRENCY_WORDS = /ر\s*\.\s*س\s*\.?|﷼|ريال|ریال|\bSAR\b|\bSR\b/gi;

/**
 * A SAR amount as typed ("120", "120.5", "1,250.75", "١٢٠٫٥٠", "SAR 99") → integer halalas. Blank = 0. null = not an amount
 * (negative, letters, more than two decimals). Never goes through floating point, so 0.29 is 29 and not 28.999….
 */
export function parseSarToCents(input: string | number | null | undefined): number | null {
  if (input == null) return 0;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    const c = Math.round(input * 100);
    return Math.abs(input * 100 - c) < 1e-6 ? c : null;
  }
  let s = normalizeDigits(input).replace(CURRENCY_WORDS, "").trim();
  if (s === "") return 0;
  // A space inside the number is only a thousands separator ("1 250"); "12 50" is a typo, not 1250 riyals.
  if (/\s/.test(s)) { if (!/^\d{1,3}(?:\s\d{3})+(?:[.,]\d{1,2})?$/.test(s)) return null; s = s.replace(/\s+/g, ""); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    if (s.split(dec).length > 2) return null;
    const [whole, frac = ""] = s.split(dec);
    if (!new RegExp(`^\\d{1,3}(\\${thou}\\d{3})*$`).test(whole)) return null;
    s = `${whole.split(thou).join("")}.${frac}`;
  } else if (commas) {
    if (commas === 1 && /^\d*,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
    else return null;
  } else if (dots > 1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); else return null;
  }
  const m = /^(\d*)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || (m[1] === "" && m[2] === undefined) || m[1].length > 9) return null;
  return Number(m[1] || "0") * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** Halalas → what goes in a SAR input: 12050 → "120.5"; 12000 → "120"; null / 0 → "". */
export function formatSarInput(cents: number | null | undefined): string {
  if (!cents || cents <= 0 || !Number.isFinite(cents)) return "";
  const c = Math.round(cents), r = c % 100;
  return r === 0 ? String(Math.floor(c / 100)) : `${Math.floor(c / 100)}.${String(r).padStart(2, "0").replace(/0$/, "")}`;
}

/** One cash-on-delivery box → halalas, or the i18n key of the problem (a blank box is a valid 0 = prepaid parcel). */
export function validateCod(text: string): { cents: number; error?: "fob.val_cod" | "fob.val_cod_max" } {
  const c = parseSarToCents(text);
  if (c == null) return { cents: 0, error: "fob.val_cod" };
  if (c > COD_MAX_CENTS) return { cents: c, error: "fob.val_cod_max" };
  return { cents: c };
}

export interface CodRowLike { cod?: string | null }
/** Cash the drivers will collect for a manifest (rows with a valid amount only) and how many parcels carry one. */
export function sumCod(rows: CodRowLike[]): { totalCents: number; parcels: number; invalid: number } {
  let totalCents = 0, parcels = 0, invalid = 0;
  for (const r of rows) {
    const t = (r.cod ?? "").trim(); if (!t) continue;
    const v = validateCod(t);
    if (v.error) { invalid++; continue; }
    if (v.cents > 0) { totalCents += v.cents; parcels++; }
  }
  return { totalCents, parcels, invalid };
}

export interface CashFigures { collectedCents?: number | null; receivedCents?: number | null; outstandingCents?: number | null }
/** Outstanding = collected − received, never below zero (the server value wins when it is given). */
export const outstandingOf = (c: CashFigures) => Math.max(0, c.outstandingCents ?? (c.collectedCents ?? 0) - (c.receivedCents ?? 0));
/** Totals over offers/orders (cards on the request page and the cash page header). */
export function sumCash(list: CashFigures[]): { collectedCents: number; receivedCents: number; outstandingCents: number } {
  let collectedCents = 0, receivedCents = 0, outstandingCents = 0;
  for (const c of list) { collectedCents += c.collectedCents ?? 0; receivedCents += c.receivedCents ?? 0; outstandingCents += outstandingOf(c); }
  return { collectedCents, receivedCents, outstandingCents };
}

/** "Receive money from driver": the amount typed for an order with `outstanding` halalas still with the driver. */
export function receiveAmountCheck(text: string, outstanding: number): { cents: number; error?: "required" | "invalid" | "max" } {
  const c = parseSarToCents(text);
  if (c == null) return { cents: 0, error: "invalid" };
  if (c <= 0) return { cents: 0, error: "required" };
  if (c > outstanding) return { cents: c, error: "max" };
  return { cents: c };
}

/** Share of a progress bar (0–100), safe for 0 assigned parcels and for scans above the assigned count. */
export const progressPct = (done: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0);

// ───────── Support tickets (E15) ─────────
export const ATTACH_MAX = 3;
export const ATTACH_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACH_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
export const REOPEN_WINDOW_DAYS = 14;

/** i18n key of why a picked file cannot be attached, or null. `already` = files attached so far. */
export function attachmentProblem(file: { size: number; type: string; name: string }, already: number): string | null {
  if (already >= ATTACH_MAX) return "fob.att_too_many";
  const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "");
  if (!(ATTACH_TYPES as readonly string[]).includes(type)) return "fob.att_bad_type";
  if (file.size > ATTACH_MAX_BYTES) return "fob.att_too_big";
  if (file.size <= 0) return "fob.att_bad_type";
  return null;
}
export const isImageMime = (mime: string | null | undefined) => !!mime && mime.startsWith("image/");
export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const attachmentUrl = (id: string) => `/api/v1/tickets/attachments/${encodeURIComponent(id)}`;

export interface TicketLike { id: string; status: string; updatedAt?: string | null; resolvedAt?: string | null; assignedTo?: unknown }
/** The customer owes nothing while the ticket is resolved; support replied (`in_review`) or resolved it since the customer last looked → "waiting for you". */
export function ticketNeedsYou(t: TicketLike, seen: Record<string, string>): boolean {
  if (!t.updatedAt) return false;
  const last = seen[t.id];
  const changedSince = !last || new Date(t.updatedAt).getTime() > new Date(last).getTime();
  return t.status === "in_review" && changedSince;
}
/** Reopen is offered on a resolved ticket for 14 days after it was resolved (the server decides; this only hides a hopeless button). */
export function reopenWindowOpen(t: TicketLike, now: number = Date.now()): boolean {
  if (t.status !== "resolved") return false;
  const at = t.resolvedAt ?? t.updatedAt;
  if (!at) return true;
  return now - new Date(at).getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}
/** "Assigned to support" when someone is assigned (the list only has an id, the detail may have a name). */
export function assigneeName(t: { assignedTo?: unknown; assignedToName?: unknown }): string | null {
  if (typeof t.assignedToName === "string" && t.assignedToName.trim()) return t.assignedToName.trim();
  if (t.assignedTo && typeof t.assignedTo === "object" && typeof (t.assignedTo as { name?: unknown }).name === "string") return (t.assignedTo as { name: string }).name;
  return null;
}
export const isAssigned = (t: { assignedTo?: unknown }) => !!t.assignedTo;
