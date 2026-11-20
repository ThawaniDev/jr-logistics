import { sql } from "drizzle-orm";
import { db } from "@/db";
import { clearSettingsCache } from "@/server/settings";
import { resetDb } from "./factories";

/**
 * Platform update J2 / J3: `routingEnabled` and `b2bShipmentsEnabled` default to OFF. Tests that exercise route planning / the approve-route step /
 * STOP_LOCKED / re-ordering, or that create business-type parcels, switch them on in their setup:
 *   beforeEach(resetDbWithFieldModes);                      // both on (the behaviour before J)
 *   beforeEach(async () => { await resetDb(); await setFieldModes({ routing: true }); });
 * Merges into the stored platform settings row (works right after `resetDb`, when no user exists yet) and clears the settings cache.
 */
export async function setFieldModes(o: { routing?: boolean; b2b?: boolean }) {
  const patch = { ...(o.routing !== undefined ? { routingEnabled: o.routing } : {}), ...(o.b2b !== undefined ? { b2bShipmentsEnabled: o.b2b } : {}) };
  await db.execute(sql`insert into settings (key, value) values ('platform', ${JSON.stringify(patch)}::jsonb) on conflict (key) do update set value = settings.value || excluded.value, updated_at = now()`);
  clearSettingsCache();
}

/** `beforeEach` replacement for `resetDb` in tests written for the pre-J behaviour: empty database, routing AND B2B on. */
export async function resetDbWithFieldModes() {
  await resetDb();
  await setFieldModes({ routing: true, b2b: true });
}
