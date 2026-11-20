import { get } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";
import { formatSarInput, validateCod } from "./business-fieldops-lib";

/** Shared, UI-free helpers for the per-shipment manifest (business side): row model, client pre-validation, CSV parsing, paged loading. */

export type RType = "consumer" | "business";
export type RowField = "recipientType" | "recipientName" | "recipientPhone" | "address" | "externalRef" | "contents" | "notes" | "city" | "lat" | "cod";
/** Field → i18n key of the problem. */
export type RowErrors = Partial<Record<RowField, string>>;

export interface ManifestRow {
  uid: string;
  recipientType: RType;
  recipientName: string; recipientPhone: string; address: string;
  contents: string; notes: string; externalRef: string;
  /** Cash on delivery the driver collects, in SAR as typed ("" = prepaid). Sent as integer halalas (`codCents`, E17). */
  cod: string;
  /** The warehouse-system connection this order was imported from (externalRef is then that system's barcode). Never typed by the business. */
  partnerId?: string | null;
  /** Pins are never typed by the business but must survive an edit of a saved draft. */
  lat?: number | null; lng?: number | null;
}

export const MAX_ROWS = 2000;
export const DEFAULT_PER_DRIVER = 30;

let seq = 0;
export const newUid = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
export const emptyRow = (over: Partial<ManifestRow> = {}): ManifestRow => ({ uid: newUid(), recipientType: "consumer", recipientName: "", recipientPhone: "", address: "", contents: "", notes: "", externalRef: "", cod: "", ...over });

/** Halalas of a cash-on-delivery box (0 when blank or not a valid amount — validateRow reports the latter before anything is sent). */
export const codCentsOf = (cod: string) => { const v = validateCod(cod); return v.error ? 0 : v.cents; };

/**
 * What the API expects for one parcel (the city is always the request's delivery city, so it is left out). Blank text is sent as null, never as "".
 * `b2b` = the platform's B2B switch (J3): while it is off the type is always "consumer" (the API refuses "business" with B2B_DISABLED).
 */
export const toWire = (r: ManifestRow, b2b = true) => ({
  recipientType: b2b ? r.recipientType : ("consumer" as RType), recipientName: r.recipientName.trim() || null, recipientPhone: r.recipientPhone.trim() || null, address: r.address.trim() || null,
  contents: r.contents.trim() || null, notes: r.notes.trim() || null, externalRef: r.externalRef.trim() || null,
  ...(codCentsOf(r.cod) > 0 ? { codCents: codCentsOf(r.cod) } : {}),
  ...(r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : {}),
  ...(r.partnerId && r.externalRef.trim() ? { partnerId: r.partnerId } : {}),
});

/** Server item → editable row (a placeholder parcel arrives with empty strings, which is exactly an empty row). */
export function fromServer(s: Record<string, unknown>): ManifestRow {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return emptyRow({
    recipientType: s.recipientType === "business" ? "business" : "consumer", recipientName: str(s.recipientName), recipientPhone: str(s.recipientPhone), address: str(s.address),
    contents: str(s.contents), notes: str(s.notes), externalRef: str(s.externalRef), cod: formatSarInput(typeof s.codCents === "number" ? s.codCents : 0), lat: typeof s.lat === "number" ? s.lat : null, lng: typeof s.lng === "number" ? s.lng : null,
    partnerId: typeof s.partnerId === "string" && s.partnerId ? s.partnerId : null,
  });
}

const has = (v: string) => v.trim().length > 0;
/** Recipient name, phone or address still missing (the server's `detailsComplete = false`). */
export const missingDetails = (r: Pick<ManifestRow, "recipientName" | "recipientPhone" | "address">) => !has(r.recipientName) || !has(r.recipientPhone) || !has(r.address);
/** A parcel about which nothing is known: it is shown as part of the "N parcels — details to follow" summary instead of an editable row. */
export const isBlankRow = (r: ManifestRow) => r.recipientType === "consumer" && !has(r.recipientName) && !has(r.recipientPhone) && !has(r.address) && !has(r.contents) && !has(r.notes) && !has(r.externalRef) && !has(r.cod) && r.lat == null && r.lng == null && !r.partnerId;
/** Parcels without recipient details: the blank ones plus the filled-in rows that still lack name, phone or address. */
export const countMissing = (rows: ManifestRow[], blank: number) => blank + rows.reduce((n, r) => n + (missingDetails(r) ? 1 : 0), 0);

export interface LoadedManifest { rows: ManifestRow[]; blank: number; later: boolean }
/**
 * A saved draft → editor state. Placeholder parcels the server created for "details later" (`detailsComplete: false`, nothing else known) become
 * a plain COUNT; everything else (complete parcels, partly filled ones) stays an editable row. `later` is on whenever any parcel is still incomplete.
 */
export function splitServerManifest(items: Array<Record<string, unknown>>): LoadedManifest {
  const rows: ManifestRow[] = []; let blank = 0, later = false;
  for (const s of items) {
    const row = fromServer(s); const incomplete = s.detailsComplete === false;
    if (incomplete) later = true;
    if (incomplete && isBlankRow(row)) blank++; else rows.push(row);
  }
  return { rows, blank, later };
}

export interface RecipientDetails { recipientName?: string; recipientPhone?: string; address?: string }
/** Same rules the server applies (name ≥ 2, Saudi/E.164 mobile, address ≥ 5). `partial` (details later): blank is fine, anything typed must still be valid. */
export function validateDetails(d: RecipientDetails, partial = false): RowErrors {
  const e: RowErrors = {};
  const name = (d.recipientName ?? "").trim(), phone = (d.recipientPhone ?? "").trim(), addr = (d.address ?? "").trim();
  if (name) { if (name.length < 2) e.recipientName = "bs.val_name"; else if (name.length > 120) e.recipientName = "bs.val_too_long"; } else if (!partial) e.recipientName = "bs.val_name";
  if (phone) { if (!normalizePhone(phone)) e.recipientPhone = "bs.val_phone"; } else if (!partial) e.recipientPhone = "bs.val_phone";
  if (addr) { if (addr.length < 5) e.address = "bs.val_address"; else if (addr.length > 300) e.address = "bs.val_too_long"; } else if (!partial) e.address = "bs.val_address";
  return e;
}

/** Strict check: name, phone or address is missing OR invalid (what must be fixed before a strict order can continue). */
export const needsRecipient = (r: Pick<ManifestRow, "recipientName" | "recipientPhone" | "address">) => Object.keys(validateDetails(r, false)).length > 0;

/** Same rules the server applies so a 500-line sheet is fixed before it is sent. `partial` = "details later" mode (see validateDetails). */
export function validateRow(r: ManifestRow, opts: { partial?: boolean } = {}): RowErrors {
  const e = validateDetails(r, !!opts.partial);
  if (r.externalRef.trim().length > 80) e.externalRef = "bs.val_too_long";
  if (r.contents.trim().length > 300) e.contents = "bs.val_too_long";
  if (r.notes.trim().length > 500) e.notes = "bs.val_too_long";
  if (has(r.cod)) { const c = validateCod(r.cod); if (c.error) e.cod = c.error; }
  return e;
}

/** Indexes whose order reference repeats an earlier row (case-insensitive) → index of the first use. */
export function duplicateRefs(rows: ManifestRow[], seed: Map<string, number> = new Map()): Map<number, number> {
  const seen = new Map(seed); const dup = new Map<number, number>();
  rows.forEach((r, i) => {
    const k = r.externalRef.trim().toLowerCase(); if (!k) return;
    const first = seen.get(k);
    if (first !== undefined) dup.set(i, first); else seen.set(k, i);
  });
  return dup;
}

// ───────── CSV ─────────
export type CsvField = "recipientName" | "recipientPhone" | "address" | "recipientType" | "externalRef" | "contents" | "notes" | "cod";
const COLUMNS: CsvField[] = ["recipientName", "recipientPhone", "address", "recipientType", "externalRef", "contents", "notes", "cod"];
export const TEMPLATE_HEADER = ["name", "phone", "address", "type", "ref", "contents", "notes", "cod"];

const squash = (s: string) => s.replace(/^﻿/, "").toLowerCase().replace(/[\s_\-.:()*/]+/g, "");
const ALIASES: Record<CsvField, string[]> = {
  recipientName: ["name", "recipient", "recipientname", "customer", "customername", "consignee", "الاسم", "اسم", "اسمالمستلم", "المستلم", "العميل", "اسمالعميل"],
  recipientPhone: ["phone", "mobile", "tel", "telephone", "recipientphone", "phonenumber", "mobilenumber", "الجوال", "رقمالجوال", "الهاتف", "رقمالهاتف", "الموبايل", "جوال", "رقمالمستلم"],
  address: ["address", "deliveryaddress", "location", "العنوان", "عنوانالتوصيل", "عنوان"],
  recipientType: ["type", "recipienttype", "customertype", "النوع", "نوع", "نوعالمستلم", "نوعالعميل"],
  externalRef: ["ref", "reference", "orderref", "orderreference", "orderid", "orderno", "ordernumber", "barcode", "externalref", "order", "المرجع", "مرجع", "رقمالطلب", "الباركود", "رقمالمرجع", "الرقمالمرجعي"],
  contents: ["contents", "content", "items", "description", "goods", "المحتوى", "المحتويات", "الوصف", "البضاعة"],
  notes: ["notes", "note", "remarks", "comment", "comments", "ملاحظات", "ملاحظة", "ملاحظاتإضافية"],
  // cash the driver collects (SAR, decimals allowed, blank = prepaid)
  cod: ["cod", "cash", "cashondelivery", "codamount", "cashamount", "codsar", "amount", "amountsar", "collect", "tocollect", "collectamount", "الدفععندالاستلام", "الدفع", "المبلغ", "مبلغ", "نقد", "نقدا", "نقدي", "كاش", "المبلغالمطلوب", "مبلغالتحصيل", "التحصيل", "کیش", "کیشآنڈیلیوری", "رقم", "وصولی", "رقمکیش"],
};
const aliasToField = new Map<string, CsvField>(COLUMNS.flatMap((f) => ALIASES[f].map((a) => [squash(a), f] as const)));

const TYPE_WORDS: Record<string, RType> = {
  consumer: "consumer", b2c: "consumer", individual: "consumer", person: "consumer", customer: "consumer", home: "consumer", فرد: "consumer", أفراد: "consumer", مستهلك: "consumer", عميل: "consumer", شخص: "consumer",
  business: "business", b2b: "business", company: "business", shop: "business", store: "business", branch: "business", منشأة: "business", منشاة: "business", شركة: "business", تجاري: "business", محل: "business", فرع: "business", أعمال: "business",
};

/** RFC-4180-ish parser: quoted fields, "" escapes, newlines inside quotes; the delimiter (, ; or tab) is sniffed from the first line. */
export function parseDelimited(textIn: string): string[][] {
  const text = textIn.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const count = (ch: string) => { let n = 0, q = false; for (const c of firstLine) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const delim = [["\t", count("\t")], [";", count(";")], [",", count(",")]].sort((a, b) => (b[1] as number) - (a[1] as number))[0];
  const d = (delim[1] as number) > 0 ? (delim[0] as string) : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === d) endCell();
    else if (c === "\n") endRow();
    else if (c === "\r") { /* swallowed: \r\n and lone \r */ if (text[i + 1] !== "\n") endRow(); }
    else cell += c;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

export interface ParsedCsvRow { line: number; row: ManifestRow; errors: RowErrors }
export interface ParsedCsv { rows: ParsedCsvRow[]; header: boolean; rowCount: number; /** B2B off: rows that said "business" and were imported as individuals. */ coerced: number }

/** Header row optional: detected when ≥ 2 cells are known column names (English or Arabic). Without it the order is name, phone, address, type, ref, contents, notes. */
export function parseManifestCsv(text: string, existingRefs: Map<string, number> = new Map(), opts: { partial?: boolean; b2b?: boolean } = {}): ParsedCsv {
  const b2b = opts.b2b !== false; // B2B shipments off: the type column is ignored and every row is an individual (counted in `coerced` when it asked for "business")
  const grid = parseDelimited(text);
  if (grid.length === 0) return { rows: [], header: false, rowCount: 0, coerced: 0 };
  const first = grid[0].map((c) => aliasToField.get(squash(c)) ?? null);
  const header = first.filter(Boolean).length >= 2;
  const map: Array<CsvField | null> = header ? first : b2b ? COLUMNS : COLUMNS.filter((c) => c !== "recipientType"); // no header: name, phone, address, [type,] ref, contents, notes, cod
  const body = header ? grid.slice(1) : grid;
  let coerced = 0;
  const parsed: ParsedCsvRow[] = body.map((cells, i) => {
    const v: Partial<Record<CsvField, string>> = {};
    cells.forEach((c, ci) => { const f = map[ci]; if (f && v[f] === undefined) v[f] = c.trim(); });
    const errors: RowErrors = {};
    const typeRaw = (v.recipientType ?? "").trim().toLowerCase();
    let type: RType = "consumer";
    if (typeRaw) { const w = TYPE_WORDS[typeRaw] ?? TYPE_WORDS[squash(typeRaw)]; if (w) type = w; else if (b2b) errors.recipientType = "bs.val_type"; }
    if (!b2b && type === "business") { type = "consumer"; coerced++; }
    // Cash on delivery: a valid amount is stored in its plain form ("١٢٠٫٥" → "120.5"); an invalid one stays as typed so the preview can flag it.
    const codRaw = (v.cod ?? "").trim(); const codCheck = validateCod(codRaw);
    const row = emptyRow({ recipientType: type, recipientName: v.recipientName ?? "", recipientPhone: v.recipientPhone ?? "", address: v.address ?? "", externalRef: v.externalRef ?? "", contents: v.contents ?? "", notes: v.notes ?? "", cod: codRaw && !codCheck.error ? formatSarInput(codCheck.cents) : codRaw });
    return { line: i + 1 + (header ? 1 : 0), row, errors: { ...validateRow(row, opts), ...errors } };
  });
  const dup = duplicateRefs(parsed.map((p) => p.row), existingRefs);
  dup.forEach((_first, i) => { parsed[i].errors.externalRef = "bs.val_ref_dup"; });
  return { rows: parsed, header, rowCount: body.length, coerced };
}

const csvCell = (s: string) => (/[",;\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** BOM so Excel opens Arabic correctly. */
export const templateCsv = (b2b = true) => {
  const cols = (r: string[]) => (b2b ? r : r.filter((_, i) => TEMPLATE_HEADER[i] !== "type")); // B2B off: no type column in the sheet
  return "﻿" + [cols(TEMPLATE_HEADER), cols(["Mona Ali", "0555555555", "King Fahd Rd 120, Riyadh", "consumer", "ORD-1001", "Clothes", "Gate 2", "120.50"]),
    cols(b2b ? ["Al Noor Pharmacy", "0501234567", "Olaya St, Building 8, Riyadh", "business", "ORD-1002", "", "", ""] : ["Sara Alharbi", "0501234567", "Olaya St, Building 8, Riyadh", "consumer", "ORD-1002", "", "", ""])]
    .map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
};

/** Map the API's per-field validation details (`shipments.<i>.<field>`) to { rowIndex → { field → i18n key } }. */
export const FIELD_ERR_KEY: Record<string, string> = { recipientType: "bs.val_type", recipientName: "bs.val_name", recipientPhone: "bs.val_phone", address: "bs.val_address", externalRef: "bs.val_ref_dup", contents: "bs.val_too_long", notes: "bs.val_too_long", city: "bs.val_city", lat: "bs.val_coords", lng: "bs.val_coords", codCents: "fob.val_cod" };
export function mapServerRowErrors(details: Record<string, unknown>): Map<number, RowErrors> {
  const out = new Map<number, RowErrors>();
  const KEY = FIELD_ERR_KEY;
  for (const k of Object.keys(details)) {
    const m = /^shipments\.(\d+)\.(\w+)$/.exec(k); if (!m) continue;
    const idx = Number(m[1]); const f = (m[2] === "lng" ? "lat" : m[2] === "codCents" ? "cod" : m[2]) as RowField;
    out.set(idx, { ...(out.get(idx) ?? {}), [f]: KEY[m[2]] ?? "bs.val_generic" });
  }
  return out;
}

/** `PATCH /requests/:id/shipments` problems: `details.field = "rows.<i>.<field>"` (also as a key of its own when it comes from schema validation) → { rowIndex → { field → i18n key } }. */
export function mapServerBulkErrors(details: Record<string, unknown>): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  const put = (k: unknown) => {
    const m = typeof k === "string" ? /^rows\.(\d+)\.(\w+)$/.exec(k) : null; if (!m) return;
    const idx = Number(m[1]); const f = m[2] === "lng" ? "lat" : m[2];
    out.set(idx, { ...(out.get(idx) ?? {}), [f]: ["id", "code", "seq"].includes(m[2]) ? "pb.cd_prob_not_found" : FIELD_ERR_KEY[m[2]] ?? "bs.val_generic" });
  };
  for (const k of Object.keys(details)) put(k);
  put(details.field);
  return out;
}

export interface ShipmentItem {
  id: string; seq: number; code: string; externalRef: string | null; recipientType: RType; recipientName: string; recipientPhone: string; address: string; city: string;
  lat: number | null; lng: number | null; contents: string | null; notes: string | null; status: string; offerId: string | null; driverName: string | null;
  stopOrder: number | null; attempts: number; loadedAt: string | null; arrivedAt: string | null; deliveredAt: string | null; deliveredDistanceM: number | null;
  /** `scan` = delivered with only the scanned parcel code (the warehouse switched the delivery code off, E9). */
  proofType: "otp" | "receipt" | "scan" | null; receiverName: string | null; hasProof: boolean; failReason: string | null; failNote: string | null; failedAt: string | null; returnedAt: string | null; demoOtp?: string;
  /** Warehouse-system link (null when the parcel was typed or imported from a CSV). */
  partnerId?: string | null; partnerStatus?: string | null; partnerStatusAt?: string | null;
  /** false = a placeholder booked "details later": recipient name / phone / address (some or all) still to come. */
  detailsComplete?: boolean;
  /** Cash on delivery (E17): integer halalas to collect, what the driver confirmed, and when. Evidence photos: `mediaCount`; a signature was captured: `hasSignature`. */
  codCents?: number | null; codCollectedCents?: number | null; codCollectedAt?: string | null; hasSignature?: boolean; mediaCount?: number;
}
/** Parcel whose recipient details are still to come (undefined on an older server = complete). */
export const detailsMissing = (s: Pick<ShipmentItem, "detailsComplete">) => s.detailsComplete === false;
export interface ShipmentPage { items: ShipmentItem[]; page: number; pageSize: number; total: number; counts: Record<string, number> }

/** All parcels of a request (pages of 200). */
export async function loadAllShipments(requestId: string): Promise<ShipmentItem[]> {
  const all: ShipmentItem[] = [];
  for (let page = 1; page <= 11; page++) {
    const r = await get<ShipmentPage>(`/requests/${requestId}/shipments?page=${page}&pageSize=200`);
    all.push(...r.items);
    if (all.length >= r.total || r.items.length === 0) break;
  }
  return all;
}

/** Mirror of the server's scan matching: parcel code, the warehouse's own reference, or the manifest number. */
export const normalizeScan = (v: string) => (v ?? "").trim().replace(/\s+/g, "").toUpperCase();
export function scanMatches(s: Pick<ShipmentItem, "code" | "externalRef" | "seq">, raw: string) {
  const v = normalizeScan(raw);
  if (!v) return false;
  if (v === s.code.toUpperCase()) return true;
  if (s.externalRef && v === normalizeScan(s.externalRef)) return true;
  return /^\d{1,4}$/.test(v) && Number(v) === s.seq;
}

export const SHIPMENT_STATUS_ORDER = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"] as const;

/** Parcel count of a delivery request row (price = parcels × unit price, so it is exact once priced); null when unknown (drafts, cars). */
export function parcelsOf(x: { service?: string; totalCents?: number | null; unitPriceCents?: number | null }): number | null {
  if (x.service !== "delivery_driver" || !x.totalCents || !x.unitPriceCents) return null;
  const n = Math.round(x.totalCents / x.unitPriceCents);
  return n > 0 ? n : null;
}

// ───────── Demo parcels (demo deployments only: GET /business/demo-shipments) ─────────
export interface DemoShipment {
  n: number; ref: string; recipientType: RType; recipientName: string; recipientPhone: string; address: string; city: string;
  lat: number | null; lng: number | null; district: string; contents: string | null; notes: string | null;
  /** Demo cash on delivery (halalas); absent on a server that does not send it. */
  codCents?: number | null;
}
export interface DemoShipmentPage { city: string; total: number; items: DemoShipment[] }
/** A demo parcel as a manifest row: `ref` becomes the order reference (also how "already added" is detected). */
export const demoToRow = (d: DemoShipment, b2b = true): ManifestRow => emptyRow({
  recipientType: b2b && d.recipientType === "business" ? "business" : "consumer", recipientName: d.recipientName, recipientPhone: d.recipientPhone, address: d.address,
  externalRef: d.ref, contents: d.contents ?? "", notes: d.notes ?? "", cod: formatSarInput(typeof d.codCents === "number" ? d.codCents : 0), lat: typeof d.lat === "number" ? d.lat : null, lng: typeof d.lng === "number" ? d.lng : null,
});

// ───────── Completing parcels booked "details later" in bulk ─────────
/** Fields a bulk completion may set (only the ones given are sent; blank = untouched). */
export interface BulkEdit { recipientName: string; recipientPhone: string; address: string }
/** Wire row of `PATCH /requests/:id/shipments`: only what was actually typed. */
export function bulkWire(id: string, e: Partial<BulkEdit>) {
  const out: { id: string; recipientName?: string; recipientPhone?: string; address?: string } = { id };
  const n = e.recipientName?.trim(), p = e.recipientPhone?.trim(), a = e.address?.trim();
  if (n) out.recipientName = n;
  if (p) out.recipientPhone = p;
  if (a) out.address = a;
  return out;
}
export const hasBulkInput = (e: Partial<BulkEdit> | undefined) => !!e && !!(e.recipientName?.trim() || e.recipientPhone?.trim() || e.address?.trim());
/** Server limit of one bulk update. */
export const BULK_MAX = 500;

export type BulkProblem = "pb.cd_prob_not_found" | "pb.cd_prob_locked" | "pb.cd_prob_dup" | "pb.cd_prob_empty";
export interface BulkCsvRow { line: number; key: string; target: ShipmentItem | null; edit: Partial<BulkEdit>; errors: RowErrors; problem: BulkProblem | null; overwrites: boolean }
export interface BulkCsv { rows: BulkCsvRow[]; header: boolean }

/**
 * Lines of `<parcel code | manifest number | order reference>, name, phone, address` (comma, semicolon or tab; header row optional and detected by its
 * column names). The key is matched like a scan: parcel code, then the warehouse's reference, then the manifest number.
 */
export function parseBulkCsv(text: string, parcels: ShipmentItem[]): BulkCsv {
  const grid = parseDelimited(text);
  if (grid.length === 0) return { rows: [], header: false };
  const byCode = new Map<string, ShipmentItem>(), byRef = new Map<string, ShipmentItem>(), bySeq = new Map<number, ShipmentItem>();
  for (const p of parcels) { byCode.set(p.code.toUpperCase(), p); if (p.externalRef && !byRef.has(normalizeScan(p.externalRef))) byRef.set(normalizeScan(p.externalRef), p); bySeq.set(p.seq, p); }
  const find = (raw: string) => { const v = normalizeScan(raw); return !v ? null : byCode.get(v) ?? byRef.get(v) ?? (/^\d{1,4}$/.test(v) ? bySeq.get(Number(v)) ?? null : null); };
  const first = grid[0].map((c, i) => (i === 0 ? null : aliasToField.get(squash(c)) ?? null));
  const header = first.filter((f) => f === "recipientName" || f === "recipientPhone" || f === "address").length >= 2;
  const col: Partial<Record<keyof BulkEdit, number>> = header
    ? Object.fromEntries(first.flatMap((f, i) => (f === "recipientName" || f === "recipientPhone" || f === "address" ? [[f, i]] : [])))
    : { recipientName: 1, recipientPhone: 2, address: 3 };
  const seen = new Set<string>();
  const rows = (header ? grid.slice(1) : grid).map((cells, i): BulkCsvRow => {
    const cell = (f: keyof BulkEdit) => { const ix = col[f]; return ix === undefined ? "" : (cells[ix] ?? "").trim(); };
    const key = (cells[0] ?? "").trim();
    const edit: Partial<BulkEdit> = { recipientName: cell("recipientName"), recipientPhone: cell("recipientPhone"), address: cell("address") };
    const target = find(key);
    const errors = validateDetails(edit, true);
    let problem: BulkProblem | null = null;
    if (!target) problem = "pb.cd_prob_not_found";
    else if (target.status !== "pending") problem = "pb.cd_prob_locked";
    else if (seen.has(target.id)) problem = "pb.cd_prob_dup";
    else if (!hasBulkInput(edit)) problem = "pb.cd_prob_empty";
    if (target) seen.add(target.id);
    return { line: i + 1 + (header ? 1 : 0), key, target, edit, errors, problem, overwrites: !!target && !detailsMissing(target) && target.status === "pending" && hasBulkInput(edit) };
  });
  return { rows, header };
}

/** The parcels still missing details as a sheet to fill in (code first, whatever is known already prefilled). */
export const incompleteSheetCsv = (items: ShipmentItem[]) => "\uFEFF" + [["code", "name", "phone", "address"], ...items.map((s) => [s.code, s.recipientName, s.recipientPhone, s.address])].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
