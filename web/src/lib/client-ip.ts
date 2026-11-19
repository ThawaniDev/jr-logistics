import net from "node:net";

/**
 * The caller's IP for rate limiting and audit — never trust what the *client* wrote.
 *
 * `X-Forwarded-For` is a list where each proxy APPENDS the address it saw, so the LEFT-most entries are whatever the client
 * claimed and only the RIGHT-most entries come from infrastructure we control. Reading the first entry (the old behaviour)
 * let anyone rotate a header to dodge per-IP limits.
 *
 * `TRUSTED_PROXY` (env) says how the app is deployed:
 *  - an integer N (default `1`): N trusted proxies sit in front; use the N-th entry from the right.
 *  - `cloudflare`: use `CF-Connecting-IP` (only safe when the origin accepts traffic from Cloudflare only).
 *  - `none` / `0`: no proxy headers are trusted; every caller is `unknown` (still safe, but all callers share one bucket).
 */
export function clientIp(headers: Pick<Headers, "get">, mode = process.env.TRUSTED_PROXY ?? "1"): string {
  const m = mode.trim().toLowerCase();
  const ok = (v: string | null | undefined) => (v && net.isIP(v.trim()) ? v.trim() : null);
  if (m === "none" || m === "0") return "unknown";
  if (m === "cloudflare") return ok(headers.get("cf-connecting-ip")) ?? "unknown";
  const hops = Number.parseInt(m, 10);
  if (!Number.isInteger(hops) || hops < 1) return "unknown";
  const parts = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return ok(headers.get("x-real-ip")) ?? "unknown";
  // Fewer entries than trusted hops means the header did not pass through our proxies: do not guess.
  if (parts.length < hops) return "unknown";
  return ok(parts[parts.length - hops]) ?? "unknown";
}
