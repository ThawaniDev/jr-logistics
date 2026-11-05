import { z } from "zod";
import { defineRoutes } from "../router";
import { jobAccess } from "@/server/access";
import { listMessages, postMessage } from "@/server/support";
import { timeline } from "@/server/views";

defineRoutes([
  { method: "GET", path: "/offers/:id/timeline", auth: "user", handler: async ({ user, params }) => {
    const a = await jobAccess(user, params.id);
    const all = await timeline(a.request.id);
    return { items: all.filter((e) => !e.offerId || e.offerId === a.offer.id) };
  } },
  { method: "GET", path: "/offers/:id/messages", auth: "user", handler: async ({ user, params, query }) => ({ items: await listMessages(user, params.id, query.get("since") ?? undefined) }) },
  { method: "POST", path: "/offers/:id/messages", auth: "user", status: 201, body: z.object({ body: z.string().min(1).max(1000) }), handler: ({ user, params, input }) => postMessage(user, params.id, input.body) },
]);
