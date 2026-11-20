import { pinnedFetch } from "../integrations";
import { PartnerError, type HttpOptions, type HttpResult } from "./types";

/** The only way adapters reach the network: SSRF-pinned, time-limited, JSON (or form) in / JSON out. Tests inject a stub via `setPartnerFetch`. */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const MAX_BODY = 2 * 1024 * 1024; // partner list endpoints can be large; anything beyond is refused, never truncated
const pinned: Fetcher = (url, init) => pinnedFetch(url, init, { maxBytes: MAX_BODY });
let fetcher: Fetcher = pinned;
export const setPartnerFetch = (f: Fetcher | null) => { fetcher = f ?? pinned; };

export async function partnerHttp(method: string, url: string, o: HttpOptions = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json", ...(o.headers ?? {}) };
  let body: string | undefined;
  if (o.json !== undefined) { body = JSON.stringify(o.json); headers["content-type"] = "application/json"; }
  else if (o.form) { body = new URLSearchParams(o.form).toString(); headers["content-type"] = "application/x-www-form-urlencoded"; }
  if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
  try {
    const res = await fetcher(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    const contentType = res.headers.get("content-type") ?? "";
    const full = await res.text();
    let parsed: unknown = null, unreadable = false;
    try { parsed = full ? JSON.parse(full) : null; } catch { parsed = null; unreadable = true; }
    const ok = res.status >= 200 && res.status < 300;
    // A success that should be JSON but cannot be read is not a success (it would read as "no orders" / "no status").
    if (ok && unreadable && (/json/i.test(contentType) || /^\s*[[{]/.test(full))) throw new PartnerError("unavailable", "The partner system sent an unreadable answer");
    return { status: res.status, ok, body: parsed, text: full.slice(0, 2000), contentType };
  } catch (e) {
    if (e instanceof PartnerError) throw e;
    const msg = e instanceof Error ? e.message : "network error";
    throw new PartnerError("unavailable", /timeout|abort/i.test(msg) ? "The partner system did not answer in time" : /larger than/.test(msg) ? "The partner system sent an answer that is too large" : `Cannot reach the partner system (${msg.slice(0, 120)})`);
  }
}

/** The human-readable part of a partner error body (each vendor names it differently). */
export function errorDetail(r: HttpResult): string {
  const b = r.body as Record<string, unknown> | null;
  if (b && typeof b === "object") {
    const nested = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>).message : null;
    const v = nested ?? b.message ?? b.Message ?? b.messageKey ?? b.error ?? b.detail;
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 160);
  }
  return r.text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Maps an HTTP failure to a typed error so the UI and retry logic can tell "fix your key" from "try later". */
export function failFrom(r: HttpResult, what: string): never {
  const detail = errorDetail(r);
  if (r.status === 401 || r.status === 403) throw new PartnerError("auth", `${what}: the partner rejected the credentials${detail ? ` (${detail})` : ""}`, r.status);
  if (r.status === 404) throw new PartnerError("not_found", `${what}: not found${detail ? ` (${detail})` : ""}`, r.status);
  if (r.status >= 500 || r.status === 429 || r.status === 408) throw new PartnerError("unavailable", `${what}: the partner system is unavailable (HTTP ${r.status})`, r.status);
  throw new PartnerError("rejected", `${what}: rejected by the partner (HTTP ${r.status})${detail ? ` — ${detail}` : ""}`, r.status);
}

/** Small readers shared by the adapters: vendors send numbers as strings, empty strings for "none", and so on. */
export const str = (v: unknown): string | null => (v == null || typeof v === "object" ? null : String(v).trim() || null);
export const num = (v: unknown): number | null => { if (v == null || v === "" || typeof v === "boolean") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
export const date = (v: unknown): Date | null => { const s = str(v); if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };
export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Joins non-empty parts of an address. */
export const joinParts = (...p: unknown[]): string | null => { const s = p.map(str).filter(Boolean).join(", "); return s || null; };
