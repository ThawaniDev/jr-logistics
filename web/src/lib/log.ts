/**
 * Structured server logging: one JSON line per event, always carrying the correlation id, never carrying secrets.
 * Database driver errors embed the failing statement WITH its bound parameters (IBANs, hashes, phone numbers) in `message`, so
 * messages are cut at the first parameter dump and capped; request bodies, headers and query strings are never logged.
 */
const MAX_MSG = 300;

/** Things that must never reach a log even when they appear inside an error message (an HTTP client or a driver may echo what it was given). */
const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"], // an Authorization header value
  [/\bjrk_[A-Za-z0-9_-]+/g, "jrk_[redacted]"],                           // a company API key
  [/(\/integrations\/hooks\/[^/\s]+\/)[^/\s?#]+/g, "$1[redacted]"],      // the secret token of an inbound webhook URL (the router redacts the same segment in the path it logs)
  [/\bSA\d{2}[A-Z0-9]{18,22}\b/g, "[iban]"],
  [/(?:\+|00)?966\s?5\d{8}\b|\b05\d{8}\b/g, "[phone]"],
];

export function scrub(message: string): string {
  let out = message.split(/\r?\n(?:params|values):/i)[0];
  for (const [re, to] of SECRET_SHAPES) out = out.replace(re, to);
  return out.replace(/(password|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*)\S+/gi, "$1$2[redacted]").slice(0, MAX_MSG);
}

export interface ErrorLogCtx { correlationId: string; method?: string; path?: string; userId?: string | null }

/** Safe, flat description of an error: class, scrubbed message, database error code, and the first stack frames. */
export function describeError(e: unknown) {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; constraint?: string; table?: string }; stack?: string };
  return {
    name: String(err?.name ?? "Error"),
    message: scrub(String(err?.message ?? e)),
    pgCode: err?.cause?.code ?? (typeof err?.code === "string" ? err.code : undefined),
    pgConstraint: err?.cause?.constraint,
    pgTable: err?.cause?.table,
    stack: typeof err?.stack === "string" ? err.stack.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ")).slice(0, 6).map((l) => l.slice(0, 200)) : undefined,
  };
}

export function logError(e: unknown, ctx: ErrorLogCtx) {
  console.error(JSON.stringify({ level: "error", ts: new Date().toISOString(), ...ctx, path: ctx.path?.split("?")[0], ...describeError(e) }));
}

export function logInfo(msg: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), msg, ...fields }));
}
