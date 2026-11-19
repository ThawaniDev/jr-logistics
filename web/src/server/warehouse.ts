import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { businessProfiles, requests, users, type Request, type User, type WarehouseOps } from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import { getSettings, type Settings } from "./settings";
import { audit } from "./audit";
import { geocodeAddress, haversine } from "./routing";
import { SERVICE_MAP, type ServiceKey } from "./catalog";

/**
 * Per-warehouse operation (decisions E1–E3, E9, E10). Every warehouse (business) has a map location and four switches that the platform
 * (superadmin) sets per warehouse; a switch that was never set inherits `warehouseDefaults` from the platform settings.
 */
export const OPS_KEYS = ["requireArrivalConfirmation", "requireLoadingRecord", "requireDeliveryOtp", "requireSignature"] as const satisfies ReadonlyArray<keyof WarehouseOps>;
export type OpsOverrides = Partial<Record<(typeof OPS_KEYS)[number], boolean | null>>;

/** Defaults ⊕ overrides, ignoring junk keys and non-boolean values. */
export function mergeOps(defaults: WarehouseOps, overrides: Partial<WarehouseOps> | null | undefined): WarehouseOps {
  const out = { ...defaults };
  for (const k of OPS_KEYS) { const v = overrides?.[k]; if (typeof v === "boolean") out[k] = v; }
  return out;
}

export async function effectiveOps(businessId: string, x: Exec = db, cfg?: Settings): Promise<WarehouseOps> {
  const s = cfg ?? (await getSettings(x));
  const [bp] = await x.select({ ops: businessProfiles.ops }).from(businessProfiles).where(eq(businessProfiles.userId, businessId));
  return mergeOps(s.warehouseDefaults, bp?.ops);
}

const validPoint = (lat: unknown, lng: unknown): lat is number => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export async function warehouseLocation(businessId: string, x: Exec = db): Promise<{ lat: number; lng: number } | null> {
  const [bp] = await x.select({ lat: businessProfiles.warehouseLat, lng: businessProfiles.warehouseLng }).from(businessProfiles).where(eq(businessProfiles.userId, businessId));
  return bp && bp.lat != null && bp.lng != null ? { lat: bp.lat, lng: bp.lng } : null;
}

/** The request's own pin, else the warehouse's current location. */
export async function pickupPinOf(r: Pick<Request, "pickupLat" | "pickupLng" | "businessId">, x: Exec = db): Promise<{ lat: number; lng: number } | null> {
  if (r.pickupLat != null && r.pickupLng != null) return { lat: r.pickupLat, lng: r.pickupLng };
  return warehouseLocation(r.businessId, x);
}

/**
 * A warehouse moved its pin: requests that merely INHERITED the old one follow it (so drivers are never held to a stale location);
 * a request that carries a different, explicit pin is left alone.
 */
async function followWarehouse(tx: Exec, businessId: string, old: { lat: number; lng: number } | null, next: { lat: number; lng: number }) {
  const live = ["draft", "published", "filling", "assigned", "confirmed", "in_progress"];
  await tx.update(requests).set({ pickupLat: next.lat, pickupLng: next.lng, updatedAt: new Date() }).where(and(
    eq(requests.businessId, businessId), inArray(requests.status, live),
    old ? or(isNull(requests.pickupLat), and(sql`${requests.pickupLat} = ${old.lat}`, sql`${requests.pickupLng} = ${old.lng}`)) : isNull(requests.pickupLat),
  ));
}

export async function setWarehouseLocation(actor: User, businessId: string, lat: number, lng: number) {
  if (!validPoint(lat, lng)) throw err("VALIDATION", "Latitude / longitude are out of range", { field: "lat" });
  const isOwner = actor.id === businessId && actor.role === "business";
  if (!isOwner) requirePerm(actor, "users.edit");
  return db.transaction(async (tx) => {
    const [bp] = await tx.select().from(businessProfiles).where(eq(businessProfiles.userId, businessId)).for("update");
    if (!bp) throw err("NOT_FOUND", "Warehouse not found");
    const old = bp.warehouseLat != null && bp.warehouseLng != null ? { lat: bp.warehouseLat, lng: bp.warehouseLng } : null;
    await tx.update(businessProfiles).set({ warehouseLat: lat, warehouseLng: lng }).where(eq(businessProfiles.userId, businessId));
    await followWarehouse(tx, businessId, old, { lat, lng });
    await audit(actor, "warehouse.location", "business", businessId, { from: old, to: { lat, lng } }, tx);
    return { lat, lng };
  });
}

/** What the superadmin sees for one warehouse: pin, effective switches, the overrides that produce them and the platform defaults. */
export async function warehouseAdminView(businessId: string, x: Exec = db) {
  const cfg = await getSettings(x);
  const [bp] = await x.select().from(businessProfiles).where(eq(businessProfiles.userId, businessId));
  if (!bp) throw err("NOT_FOUND", "Warehouse not found");
  const overrides: Record<string, boolean | null> = {};
  for (const k of OPS_KEYS) overrides[k] = typeof bp.ops?.[k] === "boolean" ? (bp.ops![k] as boolean) : null;
  return {
    lat: bp.warehouseLat, lng: bp.warehouseLng, ops: mergeOps(cfg.warehouseDefaults, bp.ops), overrides, defaults: cfg.warehouseDefaults,
  };
}

export async function patchWarehouseAdmin(actor: User, businessId: string, patch: { lat?: number | null; lng?: number | null; ops?: OpsOverrides }) {
  requirePerm(actor, "users.edit");
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, businessId));
  if (u?.role !== "business") throw err("NOT_FOUND", "Warehouse not found");
  if ((patch.lat == null) !== (patch.lng == null)) throw err("VALIDATION", "Give both latitude and longitude", { field: "lat" });
  if (patch.lat != null && !validPoint(patch.lat, patch.lng)) throw err("VALIDATION", "Latitude / longitude are out of range", { field: "lat" });
  if (patch.lat != null) await setWarehouseLocation(actor, businessId, patch.lat, patch.lng as number);
  if (patch.ops) {
    await db.transaction(async (tx) => {
      const [bp] = await tx.select().from(businessProfiles).where(eq(businessProfiles.userId, businessId)).for("update");
      const next: Partial<WarehouseOps> = { ...(bp.ops ?? {}) };
      for (const k of OPS_KEYS) {
        if (!(k in patch.ops!)) continue;
        const v = patch.ops![k];
        if (v === null) delete next[k]; else if (typeof v === "boolean") next[k] = v; else throw err("VALIDATION", "Switches are true, false or null (inherit)", { field: `ops.${k}` });
      }
      await tx.update(businessProfiles).set({ ops: Object.keys(next).length ? next : null }).where(eq(businessProfiles.userId, businessId));
      await audit(actor, "warehouse.ops", "business", businessId, { from: bp.ops ?? null, to: next }, tx);
    });
  }
  return warehouseAdminView(businessId);
}

/**
 * Pin for a request being published: its own, else the warehouse's, else geocoded from the pickup address (Google). Persisted on the request.
 * With the arrival geofence on, a driver service without any pin cannot be published (the drivers could never check in).
 */
export async function ensurePickupPin(tx: Exec, r: Request): Promise<{ lat: number; lng: number } | null> {
  const known = await pickupPinOf(r, tx);
  if (known) { if (r.pickupLat == null) await tx.update(requests).set({ pickupLat: known.lat, pickupLng: known.lng }).where(eq(requests.id, r.id)); return known; }
  let found: { lat: number; lng: number } | null = null;
  if (r.pickupAddress) {
    const cfg = await getSettings(tx);
    const city = cfg.cities.find((c) => c.key === r.pickupCity);
    try {
      const g = await geocodeAddress(r.pickupAddress, city?.en ?? r.pickupCity, city ? { lat: city.lat, lng: city.lng } : { lat: 24.7136, lng: 46.6753 });
      if (g && !g.approximate) found = { lat: g.lat, lng: g.lng };
    } catch { /* provider trouble ≠ a missing location: fall through to the gate below */ }
  }
  if (found) { await tx.update(requests).set({ pickupLat: found.lat, pickupLng: found.lng }).where(eq(requests.id, r.id)); return found; }
  const cfg = await getSettings(tx);
  if (cfg.arrivalGeofenceEnabled && !SERVICE_MAP[r.service as ServiceKey]?.driverless) throw err("WAREHOUSE_LOCATION_REQUIRED", "Set your warehouse location first — drivers must check in near it", { field: "pickupLat" });
  return null;
}

/**
 * The driver says "I've arrived". Returns what to record. With the geofence on and a known pin the driver must send GPS and be within the radius.
 * An unknown pin never blocks (legacy requests) but is recorded as `arrival_unverified`.
 */
export async function assertAtWarehouse(tx: Exec, r: Request, loc?: { lat?: number | null; lng?: number | null }) {
  const cfg = await getSettings(tx);
  if (!cfg.arrivalGeofenceEnabled) return { verified: false, distanceM: null as number | null };
  const pin = await pickupPinOf(r, tx);
  if (!pin) return { verified: false, distanceM: null as number | null, unknownPin: true };
  if (loc?.lat == null || loc?.lng == null || !validPoint(loc.lat, loc.lng)) throw err("LOCATION_REQUIRED", "Location is needed to check in at the warehouse", { radiusM: cfg.arrivalRadiusM });
  const d = Math.round(haversine(pin, { lat: loc.lat, lng: loc.lng }));
  if (d > cfg.arrivalRadiusM) throw err("TOO_FAR_FROM_WAREHOUSE", `You are ${d} m from the warehouse — check in within ${cfg.arrivalRadiusM} m`, { distanceM: d, radiusM: cfg.arrivalRadiusM });
  return { verified: true, distanceM: d };
}

