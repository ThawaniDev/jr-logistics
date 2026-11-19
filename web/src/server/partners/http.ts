import { pinnedFetch } from "../integrations";
import { PartnerError, type HttpResult } from "./types";

/** The only way adapters reach the network: SSRF-pinned, time-limited, JSON in/out. Tests inject a stub via `setPartnerFetch`. */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = pinnedFetch;
export const setPartnerFetch = (f: Fetcher | null) => { fetcher = f ?? pinnedFetch; };

export async function partnerHttp(method: string, url: string, o: { headers?: Record<string, string>; json?: unknown; timeoutMs?: number } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json", ...(o.headers ?? {}) };
  let body: string | undefined;
  if (o.json !== undefined) { body = JSON.stringify(o.json); headers["content-type"] = "application/json"; }
  if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
  try {
    const res = await fetcher(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body: parsed, text: text.slice(0, 2000) };
  } catch (e) {
    if (e instanceof PartnerError) throw e;
    const msg = e instanceof Error ? e.message : "network error";
    throw new PartnerError("unavailable", /timeout|abort/i.test(msg) ? "The partner system did not answer in time" : `Cannot reach the partner system (${msg.slice(0, 120)})`);
  }
}

/** Maps an HTTP failure to a typed error so the UI and retry logic can tell "fix your key" from "try later". */
export function failFrom(r: HttpResult, what: string): never {
  const detail = (r.body && typeof r.body === "object" && "message" in (r.body as object) ? String((r.body as { message: unknown }).message) : r.text).slice(0, 160);
  if (r.status === 401 || r.status === 403) throw new PartnerError("auth", `${what}: the partner rejected the credentials${detail ? ` (${detail})` : ""}`, r.status);
  if (r.status === 404) throw new PartnerError("not_found", `${what}: not found`, r.status);
  if (r.status >= 500 || r.status === 429 || r.status === 408) throw new PartnerError("unavailable", `${what}: the partner system is unavailable (HTTP ${r.status})`, r.status);
  throw new PartnerError("rejected", `${what}: rejected by the partner (HTTP ${r.status})${detail ? ` — ${detail}` : ""}`, r.status);
}
