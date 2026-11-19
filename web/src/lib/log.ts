/**
 * Structured server logging: one JSON line per event, always carrying the correlation id, never carrying secrets.
 * Database driver errors embed the failing statement WITH its bound parameters (IBANs, hashes, phone numbers) in `message`, so
 * messages are cut at the first parameter dump and capped; request bodies, headers and query strings are never logged.
 */
const MAX_MSG = 300;

function scrub(message: string): string {
  const cut = message.split(/\r?\n(?:params|values):/i)[0];
  return cut.replace(/(password|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*)\S+/gi, "$1$2[redacted]").slice(0, MAX_MSG);
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
