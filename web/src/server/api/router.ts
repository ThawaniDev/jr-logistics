import { ZodError, type ZodType } from "zod";
import type { User } from "@/db/schema";
import { AppError, err } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { resolveSession, SESSION_COOKIE } from "../auth/session";
import { isBackoffice } from "../auth/permissions";
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

function errorResponse(e: unknown, correlationId: string) {
  if (e instanceof ZodError) {
    const details = Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message]));
    return json({ error: { code: "VALIDATION", message: "Invalid input", correlation_id: correlationId, details } }, 422);
  }
  if (e instanceof AppError) {
    // One consistent shape: validation details are keyed by field name (same as schema errors).
    const d = { ...(e.details ?? {}) } as Record<string, unknown>;
    if (e.code === "VALIDATION" && typeof d.field === "string" && !(d.field in d)) d[d.field] = e.message;
    return json({ error: { code: e.code, message: e.message, correlation_id: correlationId, details: d } }, e.status);
  }
  const pg = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  if (pg === "23505") return json({ error: { code: "CONFLICT", message: "Duplicate record", correlation_id: correlationId, details: {} } }, 409);
  if (pg === "22P02") return json({ error: { code: "VALIDATION", message: "Invalid identifier", correlation_id: correlationId, details: {} } }, 422);
  console.error(`[${correlationId}]`, e);
  return json({ error: { code: "INTERNAL", message: "Something went wrong", correlation_id: correlationId, details: {} } }, 500);
}

function readCookie(req: Request, name: string) {
  const c = req.headers.get("cookie");
  if (!c) return null;
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}

export async function dispatch(req: Request, basePath = "/api/v1"): Promise<Response> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomToken(8);
  try {
    const url = new URL(req.url);
    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || "/" : url.pathname;
    let matched: Compiled | undefined; let params: Record<string, string> = {}; let pathExists = false;
    for (const r of table) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method !== req.method) continue;
      matched = r; params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!matched) return json({ error: { code: pathExists ? "METHOD_NOT_ALLOWED" : "NOT_FOUND", message: "Not found", correlation_id: correlationId, details: {} } }, pathExists ? 405 : 404);

    const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? null;
    const cookieTok = readCookie(req, SESSION_COOKIE);
    const token = bearer ?? cookieTok;
    const viaCookie = !bearer && !!cookieTok;
    const user = matched.auth === "public" && !token ? null : await resolveSession(token);

    if (matched.auth !== "public") {
      if (!user) throw err("UNAUTHENTICATED", "Please sign in");
      if (matched.auth === "backoffice" && !isBackoffice(user)) throw err("FORBIDDEN");
      if (Array.isArray(matched.auth) && !matched.auth.includes(user.role as Role)) throw err("FORBIDDEN");
    }
    // CSRF: cookie-authenticated state changes must come from our own origin.
    if (viaCookie && req.method !== "GET") {
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      if (!origin || !host || new URL(origin).host !== host) throw err("FORBIDDEN", "Cross-origin request blocked");
    }

    let body: unknown = undefined;
    const ctype = req.headers.get("content-type") ?? "";
    if (matched.body && req.method !== "GET") {
      body = ctype.includes("json") ? await req.json().catch(() => { throw err("VALIDATION", "Malformed JSON"); }) : {};
    } else if (req.method !== "GET" && ctype.includes("json")) {
      body = await req.clone().json().catch(() => undefined);
    }
    const input = matched.body ? matched.body.parse(body ?? {}) : body;
    const q = matched.query ? matched.query.parse(Object.fromEntries(url.searchParams)) : Object.fromEntries(url.searchParams);

    const cookies: string[] = [];
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const ctx = {
      req, user: user as User, maybeUser: user, params, query: url.searchParams, body, input, q,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown", token, viaCookie, correlationId,
      setCookie: (n: string, v: string, age: number) => cookies.push(`${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`),
      clearCookie: (n: string) => cookies.push(`${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`),
      raw: { formData: () => req.formData() },
    } satisfies Ctx & { input: unknown; q: unknown };

    const out = await matched.handler(ctx);
    if (out instanceof Response) { for (const c of cookies) out.headers.append("set-cookie", c); return out; }
    const res = json(out === undefined ? { ok: true } : out, matched.status ?? 200);
    for (const c of cookies) res.headers.append("set-cookie", c);
    res.headers.set("x-correlation-id", correlationId);
    return res;
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

/** Helper for routes that return {status, body}. */
export function dispatchExternal(r: { status: number; body: unknown }): Response {
  return json(r.body, r.status);
}
