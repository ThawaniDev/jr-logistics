import { z } from "zod";
import { defineRoutes } from "../router";
import { requirePerm } from "@/server/auth/permissions";
import { getRole, listRoles } from "@/server/roles";
import { catalogView } from "@/server/roles-catalog";
import { createRole, deleteRole, resetRole, updateRole } from "@/server/roles-write";

// Roles & permissions (J8). View = staff.view or staff.manage; every write needs staff.manage (checked in server/roles-write.ts).
// `/admin/roles/catalog` is registered BEFORE `/admin/roles/:id` (first match wins). `:id` is a role id or its key.
const bo = "backoffice" as const;
const permList = z.array(z.string().max(60)).max(100);
const description = z.string().max(300).nullish();

defineRoutes([
  { method: "GET", path: "/admin/roles/catalog", auth: bo, handler: async ({ user }) => { requirePerm(user, "staff.view", "staff.manage"); return catalogView(); } },
  { method: "GET", path: "/admin/roles", auth: bo, handler: ({ user }) => listRoles(user) },
  { method: "POST", path: "/admin/roles", auth: bo, status: 201, body: z.object({ name: z.string().max(100), description, permissions: permList.optional(), copyFrom: z.string().max(64).optional() }), handler: ({ user, input }) => createRole(user, input) },
  { method: "GET", path: "/admin/roles/:id", auth: bo, handler: ({ user, params }) => getRole(user, params.id) },
  { method: "PATCH", path: "/admin/roles/:id", auth: bo, body: z.object({ name: z.string().max(100).optional(), description, permissions: permList.optional() }), handler: ({ user, params, input }) => updateRole(user, params.id, input) },
  { method: "DELETE", path: "/admin/roles/:id", auth: bo, body: z.object({ reassignTo: z.string().max(64).nullish() }), handler: ({ user, params, input }) => deleteRole(user, params.id, input.reassignTo) },
  { method: "POST", path: "/admin/roles/:id/reset", auth: bo, handler: ({ user, params }) => resetRole(user, params.id) },
]);
