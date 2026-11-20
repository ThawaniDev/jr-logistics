import { z } from "zod";
import { defineRoutes } from "../router";
import { requirePerm } from "@/server/auth/permissions";
import { editRule, ruleHistory } from "@/server/pricing";
import { err } from "@/lib/errors";

// Editing price rules (a new version of the same scope) and their version history. Creating and retiring live in ./admin.ts.
const id = z.string().uuid();
defineRoutes([
  { method: "PUT", path: "/admin/pricing/:id", auth: "backoffice", body: z.object({
    priceCents: z.number().int().positive().max(100_000_000).optional(), providerCostCents: z.number().int().min(0).max(100_000_000).optional(),
    agreementRef: z.string().max(80).nullish(), expiresAt: z.coerce.date().nullish(), notes: z.string().max(300).nullish(),
  }), handler: async ({ user, params, input }) => {
    requirePerm(user, "pricing.edit");
    if (!id.safeParse(params.id).success) throw err("NOT_FOUND");
    return editRule(user, params.id, { ...("priceCents" in input ? { priceCents: input.priceCents } : {}), ...("providerCostCents" in input ? { providerCostCents: input.providerCostCents } : {}),
      ...("agreementRef" in input ? { agreementRef: input.agreementRef ?? null } : {}), ...("expiresAt" in input ? { expiresAt: input.expiresAt ?? null } : {}), ...("notes" in input ? { notes: input.notes ?? null } : {}) });
  } },
  { method: "GET", path: "/admin/pricing/:id/history", auth: "backoffice", handler: async ({ user, params }) => {
    requirePerm(user, "pricing.view", "pricing.edit");
    if (!id.safeParse(params.id).success) throw err("NOT_FOUND");
    return ruleHistory(params.id);
  } },
]);
