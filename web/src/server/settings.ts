import { eq } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_CITIES } from "./catalog";

/** Every policy value is configurable; defaults mirror the PRD but remain owner decisions [D]. */
export const DEFAULT_SETTINGS = {
  enabledServices: ["delivery_driver", "car_with_driver", "car_without_driver"] as string[],
  cities: DEFAULT_CITIES.map((c) => ({ ...c })) as Array<{ key: string; ar: string; en: string; ur: string; lat: number; lng: number; pickup: boolean; delivery: boolean }>,
  vatPct: 15, // recorded on margin for invoices; owner/tax decision
  settlementPeriod: "weekly" as "weekly" | "monthly",
  // cancellation policy (owner confirmation pending — configurable, penalties togglable)
  cancelPolicyEnabled: true,
  cancelWarnAt: 2, // cancellations within window that trigger a warning
  cancelSuspendAt: 4, // cancellations within window that trigger suspension
  cancelWindowDays: 7,
  cancelSuspendDays: 3,
  // operations thresholds
  lateGraceMin: 30,
  checkinEarlyMin: 180, // how long before start a driver may check in
  officeWindowMin: 30, // time an office has to assign before system broadcast
  offerExpiryMin: 120,
  unfilledAlertHours: 6,
  // overlap policy: "time_window" (default) or "single_active"
  overlapPolicy: "time_window" as "time_window" | "single_active",
  requireBusinessVerification: true,
  requireDriverVerification: true,
  separationOfDuties: true, // settlement approver must differ from reviewer
  minWithdrawalCents: 10000,
  maxTopupCents: 100_000_00,
  termsVersion: "1.0",
  termsBusiness: "",
  termsDriver: "",
  termsOffice: "",
  commissionNote: "Platform margin = customer price − provider cost per approved pricing rule.",
};
export type Settings = typeof DEFAULT_SETTINGS;

let cache: { at: number; value: Settings } | null = null;
const TTL = 5_000;

export async function getSettings(x: Exec = db): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL && x === db) return cache.value;
  const rows = await x.select().from(settings).where(eq(settings.key, "platform"));
  const stored = (rows[0]?.value ?? {}) as Partial<Settings>;
  const value = { ...DEFAULT_SETTINGS, ...stored };
  if (x === db) cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Partial<Settings>, actorId: string, x: Exec = db): Promise<Settings> {
  const current = await getSettings(x);
  const merged = { ...current, ...patch };
  await x.insert(settings).values({ key: "platform", value: merged, updatedBy: actorId })
    .onConflictDoUpdate({ target: settings.key, set: { value: merged, updatedBy: actorId, updatedAt: new Date() } });
  cache = null;
  return merged;
}
export const clearSettingsCache = () => { cache = null; };
