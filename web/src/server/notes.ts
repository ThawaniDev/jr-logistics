import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entityNotes, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { can, requirePerm } from "./auth/permissions";
import { canAny, canOpenEntity, NOTES_READ_PERMS, type ActivityEntity } from "./activity-core";
import { resolveCtx } from "./activity";
import { hit } from "./auth/ratelimit";

/** Internal staff notes (decision G6): visible to staff who can read the entity, written by `notes.manage`, never shown to customers. Soft-deleted. */
export const NOTE_MAX = 4000;
const view = (n: typeof entityNotes.$inferSelect, a: { id: string; name: string; role: string }, viewer: User) => ({
  id: n.id, entity: n.entity, entityId: n.entityId, body: n.body, pinned: n.pinned, createdAt: n.createdAt,
  author: { id: a.id, name: a.name, role: a.role }, canDelete: n.authorId === viewer.id || viewer.role === "admin", canPin: can(viewer, "notes.manage"),
});

export async function listNotes(viewer: User, entity: ActivityEntity, entityId: string) {
  if (!canAny(viewer, NOTES_READ_PERMS[entity])) throw err("FORBIDDEN", "Missing permission");
  await resolveCtx(entity, entityId);
  const rows = await db.select({ n: entityNotes, a: { id: users.id, name: users.name, role: users.role } }).from(entityNotes).innerJoin(users, eq(users.id, entityNotes.authorId))
    .where(and(eq(entityNotes.entity, entity), eq(entityNotes.entityId, entityId), isNull(entityNotes.deletedAt))).orderBy(desc(entityNotes.pinned), desc(entityNotes.createdAt)).limit(200);
  return { items: rows.map(({ n, a }) => view(n, a, viewer)), canWrite: can(viewer, "notes.manage") && canOpenEntity(viewer, entity) };
}

export async function addNote(viewer: User, entity: ActivityEntity, entityId: string, bodyRaw: string, pinned = false) {
  requirePerm(viewer, "notes.manage");
  if (!canOpenEntity(viewer, entity)) throw err("FORBIDDEN", "Missing permission");
  const body = (bodyRaw ?? "").trim();
  if (!body) throw err("VALIDATION", "Write the note first", { field: "body" });
  if (body.length > NOTE_MAX) throw err("VALIDATION", `A note can hold at most ${NOTE_MAX} characters`, { field: "body", max: NOTE_MAX });
  await resolveCtx(entity, entityId);
  await hit(`notes:add:${viewer.id}`, 60, 600);
  const [n] = await db.insert(entityNotes).values({ entity, entityId, authorId: viewer.id, body, pinned }).returning();
  await audit(viewer, "note.add", entity, entityId, { noteId: n.id, pinned });
  return view(n, { id: viewer.id, name: viewer.name, role: viewer.role }, viewer);
}

const own = async (noteId: string) => {
  const [n] = await db.select().from(entityNotes).where(and(eq(entityNotes.id, noteId), isNull(entityNotes.deletedAt)));
  if (!n) throw err("NOT_FOUND", "Note not found");
  return n;
};

export async function pinNote(viewer: User, noteId: string, pinned: boolean) {
  requirePerm(viewer, "notes.manage");
  const n = await own(noteId);
  if (!canOpenEntity(viewer, n.entity as ActivityEntity)) throw err("NOT_FOUND", "Note not found");
  const [u] = await db.update(entityNotes).set({ pinned }).where(eq(entityNotes.id, noteId)).returning();
  const [a] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, u.authorId));
  return view(u, a, viewer);
}

/** The author, or an admin, removes a note (it stays in the audit log; the row is kept with who removed it and when). */
export async function deleteNote(viewer: User, noteId: string) {
  const n = await own(noteId);
  if (!canOpenEntity(viewer, n.entity as ActivityEntity)) throw err("NOT_FOUND", "Note not found");
  if (n.authorId !== viewer.id && viewer.role !== "admin") throw err("FORBIDDEN", "Only the author or an administrator can delete a note");
  await db.update(entityNotes).set({ deletedAt: new Date(), deletedBy: viewer.id }).where(eq(entityNotes.id, noteId));
  await audit(viewer, "note.delete", n.entity, n.entityId, { noteId });
  return { ok: true };
}
