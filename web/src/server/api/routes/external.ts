import { z } from "zod";
import { defineRoutes, dispatchExternal } from "../router";
import { requestBody } from "../schemas";
import { authenticateKey, logApiCall, createExternalJob, listExternalJobs, getExternalJob, externalJobEvents } from "@/server/integrations";
import { AppError, err } from "@/lib/errors";
import { hit } from "@/server/auth/ratelimit";
import type { User } from "@/db/schema";

/** External (X-API-Key) API. Scoped, rate-limited, logged, idempotent create. */
const ext = async (req: Request, scope: string, fn: (b: User) => Promise<{ status?: number; body: unknown }>) => {
  const started = Date.now();
  let biz: string | null = null, key: string | null = null, status = 200;
  try {
    const a = await authenticateKey(req.headers.get("x-api-key"));
    biz = a.business.id; key = a.keyId;
    if (!a.scopes.includes(scope)) throw err("FORBIDDEN", `Missing scope ${scope}`);
    await hit(`api:${a.keyId}`, 120, 60);
    const r = await fn(a.business); status = r.status ?? 200;
    return { status, body: r.body };
  } catch (e) { status = e instanceof AppError ? e.status : 500; throw e; }
  finally { await logApiCall(biz, key, req.method, new URL(req.url).pathname, status, started); }
};

defineRoutes([
  { method: "GET", path: "/jobs", auth: "public", handler: async ({ req, query }) => dispatchExternal(await ext(req, "jobs:read", async (b) => ({ body: await listExternalJobs(b, { status: query.get("status") ?? undefined, page: Number(query.get("page") ?? 1), pageSize: Number(query.get("pageSize") ?? 20) }) }))) },
  { method: "POST", path: "/jobs", auth: "public", body: requestBody, handler: async ({ req, input }) => dispatchExternal(await ext(req, "jobs:write", async (b) => {
    const r = await createExternalJob(b, input, req.headers.get("idempotency-key"));
    return { status: r.replay ? 200 : r.status, body: r.body };
  })) },
  { method: "GET", path: "/jobs/:id", auth: "public", handler: async ({ req, params }) => dispatchExternal(await ext(req, "jobs:read", async (b) => ({ body: await getExternalJob(b, params.id) }))) },
  { method: "GET", path: "/jobs/:id/events", auth: "public", handler: async ({ req, params }) => dispatchExternal(await ext(req, "jobs:read", async (b) => ({ body: await externalJobEvents(b, params.id) }))) },
]);
export { z };
