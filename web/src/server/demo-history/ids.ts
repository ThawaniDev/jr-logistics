/**
 * Every row the demo-history generator creates is identifiable:
 *  - uuids are DETERMINISTIC and carry a fixed marker:  5eed1157-<kind:4 hex>-4000-8000-<counter:12 hex>
 *    (random v4 ids can never look like this: the 3rd and 4th groups of a random uuid are random, these are fixed);
 *  - references use a tagged pattern that still parses like the platform's own (`<LETTERS>-<digits>`): JRH-000012, TKH-…, CPH-…, CODH-…, INVH-…;
 *  - generated people use phones in the fictitious block +966 5001 xxxxx (recipients: +966 5002 xxxxx) and users.source = 'seed', is_demo = false;
 *  - ledger entries (whose ids come from the platform's own `post()`) carry the idempotency-key prefix `hist:`.
 */
export const HIST_PREFIX = "5eed1157";

/** One code per table: shows up in the uuid so a row can be recognised by eye (…-0004-… is a request). */
export const KIND = {
  user: 0x01, wallet: 0x02, document: 0x03, request: 0x04, offer: 0x05, shipment: 0x06, jobEvent: 0x07, shipEvent: 0x08, settlement: 0x09, invoice: 0x0a,
  remittance: 0x0b, ticket: 0x0c, reply: 0x0d, attachment: 0x0e, complaint: 0x0f, complaintNote: 0x10, rating: 0x11, message: 0x12, notification: 0x13,
  audit: 0x14, login: 0x15, availability: 0x16, location: 0x17, msgLog: 0x18, snapshot: 0x19, note: 0x1a, withdrawal: 0x1b, agreement: 0x1c, invite: 0x1d,
  terms: 0x1e, media: 0x1f, webhook: 0x20, apiKey: 0x21, custody: 0x22, profile: 0x23, session: 0x24,
} as const;
export type Kind = keyof typeof KIND;

export const hid = (kind: Kind, n: number): string =>
  `${HIST_PREFIX}-${KIND[kind].toString(16).padStart(4, "0")}-4000-8000-${Math.floor(n).toString(16).padStart(12, "0")}`;

const RE = /^5eed1157-[0-9a-f]{4}-4000-8000-[0-9a-f]{12}$/;
export const isHistId = (id: string | null | undefined) => !!id && RE.test(id);

/** Lowest / highest uuid a generated row can have (for index-friendly range deletes; always combined with the exact pattern). */
export const HIST_LO = `${HIST_PREFIX}-0000-4000-8000-000000000000`;
export const HIST_HI = `${HIST_PREFIX}-ffff-4000-8000-ffffffffffff`;
/** SQL fragment: `col` is a generated id. */
export const histIdSql = (col: string) => `(${col} >= '${HIST_LO}' and ${col} <= '${HIST_HI}' and ${col}::text like '${HIST_PREFIX}-%-4000-8000-%')`;

/** Reference formats: tagged so a generated order never looks like (or collides with) a real one, yet `splitParcelCode()` still parses them. */
export const REF_PREFIX = { request: "JRH", ticket: "TKH", complaint: "CPH", remittance: "CODH", invoice: "INVH" } as const;
export const refOf = (p: keyof typeof REF_PREFIX, n: number) => `${REF_PREFIX[p]}-${String(n).padStart(6, "0")}`;

/** Prefix of every ledger idempotency key written by the generator. */
export const LEDGER_PREFIX = "hist:";

/** Fictitious phone blocks (+966 5001 xxxxx people, +966 5002 xxxxx parcel recipients). */
export const personPhone = (n: number) => `+9665001${String(n).padStart(5, "0")}`;
export const recipientPhone = (n: number) => `+9665002${String(n % 100000).padStart(5, "0")}`;
export const PERSON_PHONE_LIKE = "+9665001%";
export const STAFF_EMAIL_DOMAIN = "seed.jrlogistics.demo";

/** Per-run id counters (deterministic: the same generation order gives the same ids). */
export class IdGen {
  private c = new Map<string, number>();
  next(kind: Kind): string { const n = (this.c.get(kind) ?? 0) + 1; this.c.set(kind, n); return hid(kind, n); }
  count(kind: Kind) { return this.c.get(kind) ?? 0; }
  /** Plain running number (reference numbers, phone numbers …). */
  seq(key: string): number { const n = (this.c.get(`seq:${key}`) ?? 0) + 1; this.c.set(`seq:${key}`, n); return n; }
}
