import { defineRoutes } from "../router";
import { env } from "@/lib/env";
import { err } from "@/lib/errors";
import { processWebhookQueue } from "@/server/integrations";
import { pollPartners, processPartnerOutbox } from "@/server/partners/service";
import { runMaintenance } from "@/server/maintenance";
import { timingSafeEqual } from "node:crypto";
import { describeError } from "@/lib/log";

const guard = (req: Request) => {
  const given = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(env.cronSecret);
  if (!env.cronSecret || a.length !== b.length || !timingSafeEqual(a, b)) throw err("UNAUTHENTICATED", "Invalid cron secret");
};
/**
 * Every step of the tick runs on its own: a webhook queue or a partner poll that blows up must not stop the maintenance (offer expiry, refunds, auto-settlement) from running,
 * and a failing step is reported in the answer (`{ error }`) instead of turning the whole tick into a 500 that a cron caller retries forever.
 */
const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await fn(); }
  catch (e) { console.warn(JSON.stringify({ level: "warn", msg: "cron step failed", step: name, ...describeError(e) })); return { error: name }; }
};
defineRoutes([
  { method: "POST", path: "/cron/tick", auth: "public", handler: async ({ req }) => {
    guard(req);
    return { webhooks: await step("webhooks", () => processWebhookQueue(50)), partners: await step("partners", () => processPartnerOutbox(50)), partnerPoll: await step("partnerPoll", () => pollPartners()), maintenance: await step("maintenance", () => runMaintenance()) };
  } },
]);
