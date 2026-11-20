import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { err } from "@/lib/errors";
import { entityActivity, exportActivity } from "@/server/activity";
import { isActivityEntity, type ActivityEntity } from "@/server/activity-core";
import { addNote, deleteNote, listNotes, pinNote } from "@/server/notes";
import { locationPath } from "@/server/location-history";

const bo = "backoffice" as const;
/** Path params are plain strings: reject anything that is not a known entity / uuid with the same 404 a missing record gets. */
const target = (p: Record<string, string>): { entity: ActivityEntity; id: string } => {
  if (!isActivityEntity(p.entity) || !uuid.safeParse(p.id).success) throw err("NOT_FOUND", "Not found");
  return { entity: p.entity, id: p.id };
};
const feed = z.object({
  kinds: z.string().max(300).optional().transform((v) => (v ? v.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20) : undefined)),
  actorId: uuid.optional(), q: z.string().trim().max(80).optional().transform((v) => v || undefined),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(20).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
const noteBody = z.object({ body: z.string().max(4000), pinned: z.boolean().optional() });

defineRoutes([
  // The shared activity log of one entity: request | offer | shipment | user | ticket | complaint | settlement | withdrawal.
  { method: "GET", path: "/admin/activity/:entity/:id", auth: bo, query: feed, handler: ({ user, params, q }) => entityActivity(user, { ...target(params), ...q }) },
  { method: "GET", path: "/admin/activity/:entity/:id/export", auth: bo, query: feed.omit({ page: true, pageSize: true }), handler: async ({ user, params, q }) => {
    const r = await exportActivity(user, { ...target(params), ...q });
    return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="activity-${params.entity}-${String(r.label ?? params.id).replace(/[^\w.-]+/g, "_").slice(0, 40)}.csv"`, "x-truncated": r.truncated ? "1" : "0", "cache-control": "no-store" } });
  } },
  // Internal notes
  { method: "GET", path: "/admin/notes/:entity/:id", auth: bo, handler: ({ user, params }) => { const t = target(params); return listNotes(user, t.entity, t.id); } },
  { method: "POST", path: "/admin/notes/:entity/:id", auth: bo, status: 201, body: noteBody, handler: ({ user, params, input }) => { const t = target(params); return addNote(user, t.entity, t.id, input.body, input.pinned); } },
  { method: "PATCH", path: "/admin/notes/:noteId", auth: bo, body: z.object({ pinned: z.boolean() }), handler: ({ user, params, input }) => pinNote(user, uuid.parse(params.noteId), input.pinned) },
  { method: "DELETE", path: "/admin/notes/:noteId", auth: bo, handler: ({ user, params }) => deleteNote(user, uuid.parse(params.noteId)) },
  // A driver's sampled path (personal data: drivers.sensitive, audited)
  { method: "GET", path: "/admin/location-history/:driverId", auth: bo, query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), offerId: uuid.optional() }), handler: ({ user, params, q }) => locationPath(user, uuid.parse(params.driverId), q) },
]);
