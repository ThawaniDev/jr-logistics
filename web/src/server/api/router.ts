import { ZodError, type ZodType } from "zod";
import type { User } from "@/db/schema";
import { AppError, err } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { clientIp } from "@/lib/client-ip";
import { logError } from "@/lib/log";
import { resolveSession, SESSION_COOKIE } from "../auth/session";
import { isBackoffice } from "../auth/permissions";
import { getSettings } from "../settings";
import type { Role } from "../catalog";

export type AuthSpec = "public" | "user" | "backoffice" | Role[];

export interface Ctx {
  req: Request;
  user: User;               // populated for non-public routes
  maybeUser: User | null;   // populated for public routes when a session is present
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  ip: string;
  token: string | null;
  viaCookie: boolean;
  correlationId: string;
  setCookie(name: string, value: string, maxAgeSec: number): void;
  clearCookie(name: string): void;
  raw: { formData(): Promise<FormData> };
}

export interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  auth: AuthSpec;
  body?: ZodType;
  query?: ZodType;
  status?: number;
  /** Largest accepted JSON body in bytes (default 4 MB; a 2000-parcel manifest is ~1 MB). */
  maxBytes?: number;
  /** Custom response (e.g. file download). Return a Response to bypass JSON. */
  handler: (ctx: Ctx & { input: any; q: any }) => Promise<unknown | Response>;
}

interface Compiled extends RouteDef { re: RegExp; keys: string[] }
const table: Compiled[] = [];

export function defineRoutes(defs: RouteDef[]) {
  for (const d of defs) {
    const keys: string[] = [];
    const re = new RegExp("^" + d.path.replace(/\/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
    table.push({ ...d, re, keys });
  }
}

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(headers as object) } });

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 8 MB file + multipart overhead

function errorResponse(e: unknown, correlationId: string, req?: Request) {
  const h = { "x-correlation-id": correlationId };
  if (e instanceof ZodError) {
    const details = Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message]));
    return json({ error: { code: "VALIDATION", message: "Invalid input", correlation_id: correlationId, details } }, 422, h);
  }
  if (e instanceof AppError) {
    // One consistent shape: validation details are keyed by field name (same as schema errors).
    const d = { ...(e.details ?? {}) } as Record<string, unknown>;
    if (e.code === "VALIDATION" && typeof d.field === "string" && !(d.field in d)) d[d.field] = e.message;
    return json({ error: { code: e.code, message: e.message, correlation_id: correlationId, details: d } }, e.status, h);
  }
  const pg = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  const fail = (code: "CONFLICT" | "VALIDATION", message: string, status: number) => json({ error: { code, message, correlation_id: correlationId, details: {} } }, status, h);
  if (pg === "23505") return fail("CONFLICT", "Duplicate record", 409);
  if (pg === "23503" || pg === "23514") return fail("CONFLICT", "The change conflicts with related data", 409);
  if (pg === "22P02") return fail("VALIDATION", "Invalid identifier", 422);
  if (pg === "22003" || pg === "22007" || pg === "22008" || pg === "22001") return fail("VALIDATION", "A value is out of range", 422);
  logError(e, { correlationId, method: req?.method, path: req ? new URL(req.url).pathname : undefined });
  return json({ error: { code: "INTERNAL", message: "Something went wrong", correlation_id: correlationId, details: {} } }, 500, h);
}

/** Reads a request body but never more than `max` bytes (a lying or missing Content-Length cannot make us buffer gigabytes). */
async function readBounded(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw err("PAYLOAD_TOO_LARGE", "Request body is too large", { max });
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); throw err("PAYLOAD_TOO_LARGE", "Request body is too large", { max }); }
    chunks.push(value);
  }
  const out = new Uint8Array(size); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Client-supplied trace ids are echoed back and logged: keep them short and boring. */
const safeCorrelationId = (v: string | null) => (v && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : null);

function readCookie(req: Request, name: string) {
  const c = req.headers.get("cookie");
  if (!c) return null;
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}

/** Routes still usable while a password change is pending. */
const PASSWORD_CHANGE_OK = new Set(["/auth/change-password", "/auth/me", "/auth/logout", "/catalog", "/health"]);
const MFA_SETUP_OK = new Set(["/auth/mfa/setup", "/auth/mfa/enable"]);

export async function dispatch(req: Request, basePath = "/api/v1"): Promise<Response> {
  const correlationId = safeCorrelationId(req.headers.get("x-correlation-id")) ?? randomToken(8);
  try {
    const url = new URL(req.url);
    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || "/" : url.pathname;
    let matched: Compiled | undefined; let params: Record<string, string> = {}; let pathExists = false;
    for (const r of table) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method !== req.method) continue;
      matched = r;
      try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); }
      catch { throw err("VALIDATION", "Invalid path", { field: "path" }); }
      break;
    }
    if (!matched) return json({ error: { code: pathExists ? "METHOD_NOT_ALLOWED" : "NOT_FOUND", message: "Not found", correlation_id: correlationId, details: {} } }, pathExists ? 405 : 404, { "x-correlation-id": correlationId });

    const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? null;
    const cookieTok = readCookie(req, SESSION_COOKIE);
    const token = bearer ?? cookieTok;
    const viaCookie = !bearer && !!cookieTok;
    const user = matched.auth === "public" && !token ? null : await resolveSession(token);

    if (matched.auth !== "public") {
      if (!user) throw err("UNAUTHENTICATED", "Please sign in");
      if (matched.auth === "backoffice" && !isBackoffice(user)) throw err("FORBIDDEN");
      if (Array.isArray(matched.auth) && !matched.auth.includes(user.role as Role)) throw err("FORBIDDEN");
      // A temporary/initial password must be replaced before anything else works (server-side, not just a UI hint).
      const bare = path.replace(/\/$/, "");
      if (user.mustChangePassword && !PASSWORD_CHANGE_OK.has(bare)) throw err("PASSWORD_CHANGE_REQUIRED", "You must change your password first");
      // When the platform requires two-step verification, staff without it can do nothing except enrol (server-side, like the password rule).
      if (isBackoffice(user) && !user.totpEnabledAt && !PASSWORD_CHANGE_OK.has(bare) && !MFA_SETUP_OK.has(bare) && (await getSettings()).requireStaffMfa) throw err("MFA_SETUP_REQUIRED", "Set up two-step verification first");
    }
    // CSRF: cookie-authenticated state changes must come from our own origin.
    if (viaCookie && req.method !== "GET") {
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      let originHost: string | null = null;
      try { originHost = origin ? new URL(origin).host : null; } catch { originHost = null; } // Origin: null (sandboxed frames, redirects) is simply "not ours"
      if (!originHost || !host || originHost !== host) throw err("FORBIDDEN", "Cross-origin request blocked");
    }

    let body: unknown = undefined;
    const ctype = req.headers.get("content-type") ?? "";
    if (req.method !== "GET" && ctype.includes("json")) {
      const text = new TextDecoder().decode(await readBounded(req, matched.maxBytes ?? MAX_JSON_BYTES));
      try { body = text ? JSON.parse(text) : undefined; }
      catch { if (matched.body) throw err("VALIDATION", "Malformed JSON"); }
    } else if (matched.body && req.method !== "GET") body = {};
    const input = matched.body ? matched.body.parse(body ?? {}) : body;
    const q = matched.query ? matched.query.parse(Object.fromEntries(url.searchParams)) : Object.fromEntries(url.searchParams);

    const cookies: string[] = [];
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const ctx = {
      req, user: user as User, maybeUser: user, params, query: url.searchParams, body, input, q,
      ip: clientIp(req.headers), token, viaCookie, correlationId,
      setCookie: (n: string, v: string, age: number) => cookies.push(`${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`),
      clearCookie: (n: string) => cookies.push(`${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`),
      raw: { formData: async () => new Response(await readBounded(req, MAX_UPLOAD_BYTES) as BodyInit, { headers: { "content-type": ctype } }).formData().catch(() => { throw err("VALIDATION", "Malformed upload"); }) },
    } satisfies Ctx & { input: unknown; q: unknown };

    const out = await matched.handler(ctx);
    if (out instanceof Response) { for (const c of cookies) out.headers.append("set-cookie", c); out.headers.set("x-correlation-id", correlationId); return out; }
    const res = json(out === undefined ? { ok: true } : out, matched.status ?? 200);
    for (const c of cookies) res.headers.append("set-cookie", c);
    res.headers.set("x-correlation-id", correlationId);
    return res;
  } catch (e) {
    return errorResponse(e, correlationId, req);
  }
}

/** Helper for routes that return {status, body}. */
export function dispatchExternal(r: { status: number; body: unknown }): Response {
  return json(r.body, r.status);
}
