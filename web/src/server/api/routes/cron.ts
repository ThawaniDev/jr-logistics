import { defineRoutes } from "../router";
import { env } from "@/lib/env";
import { err } from "@/lib/errors";
import { processWebhookQueue } from "@/server/integrations";
import { runMaintenance } from "@/server/maintenance";
import { timingSafeEqual } from "node:crypto";

const guard = (req: Request) => {
  const given = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(env.cronSecret);
  if (!env.cronSecret || a.length !== b.length || !timingSafeEqual(a, b)) throw err("UNAUTHENTICATED", "Invalid cron secret");
};
defineRoutes([
  { method: "POST", path: "/cron/tick", auth: "public", handler: async ({ req }) => { guard(req); return { webhooks: await processWebhookQueue(50), maintenance: await runMaintenance() }; } },
]);
