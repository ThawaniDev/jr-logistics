import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { partnerConnections, type PartnerConnection } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptSecrets, encryptSecrets, labelSig } from "./crypto";
import { partnerHttp } from "./http";
import { getAdapter } from "./registry";
import { DEFAULT_SETTINGS, EVENT_KINDS, JR_EVENTS, type Adapter, type Ctx, type EventKind, type JrEvent, type PartnerSettings } from "./types";

// Kept free of service / stops imports on purpose: events.ts → sync.ts → config.ts must not loop back into the domain modules.

/** The connection's settings with the adapter's defaults underneath (stored values always win). */
export function settingsOf(c: Pick<PartnerConnection, "settings" | "provider">, a: Adapter | undefined = getAdapter(c.provider)): PartnerSettings {
  const s = (c.settings ?? {}) as Partial<PartnerSettings>;
  const d = a?.defaults ?? {};
  const sync: PartnerSettings["sync"] = {};
  for (const ev of JR_EVENTS) { const v = s.sync?.[ev] ?? d.sync?.[ev]; if (v !== undefined) sync[ev] = !!v; }
  const statusIn: Record<string, EventKind> = {};
  for (const [k, v] of Object.entries(s.statusIn ?? {})) if ((EVENT_KINDS as readonly string[]).includes(v)) statusIn[k.toLowerCase()] = v;
  return {
    sync, statusOut: { ...(s.statusOut ?? {}) }, statusIn,
    autoCancel: s.autoCancel ?? d.autoCancel ?? DEFAULT_SETTINGS.autoCancel,
    // Carrier-mode partners send orders precisely so that JR delivers them: they always land in Incoming orders.
    importNew: a?.capabilities.mode === "carrier" ? true : s.importNew ?? d.importNew ?? DEFAULT_SETTINGS.importNew,
    pollMinutes: s.pollMinutes ?? d.pollMinutes ?? DEFAULT_SETTINGS.pollMinutes,
  };
}

/** The partner status to send for a JR event: the connection's own choice, else the adapter's documented default. "" / null = send nothing. */
export function statusFor(c: Pick<PartnerConnection, "settings" | "provider">, a: Adapter, ev: JrEvent): string | null {
  const own = settingsOf(c, a).statusOut[ev];
  if (own !== undefined) return own ? own : null;
  return a.defaults?.statusOut?.[ev] ?? null;
}
/** The effective JR-event → partner-status map (for views). */
export const statusMapOf = (c: Pick<PartnerConnection, "settings" | "provider">, a: Adapter) =>
  Object.fromEntries(a.capabilities.push.map((ev) => [ev, statusFor(c, a, ev)])) as Record<JrEvent, string | null>;

/** How JR reads a partner status: the connection's override, else the adapter's documented list, else its classifier, else plain "status". */
export function kindFor(c: Pick<PartnerConnection, "settings" | "provider">, a: Adapter, status: string, parsed?: EventKind): EventKind {
  const k = status.trim().toLowerCase();
  const own = settingsOf(c, a).statusIn[k];
  if (own) return own;
  const listed = a.statusIn?.find((s) => s.value.toLowerCase() === k);
  if (listed) return listed.kind;
  // What the adapter read from the payload itself (e.g. the custom contract's documented "cancelled"), else its classifier.
  return parsed ?? a.classify?.(status) ?? "status";
}

export const syncOn = (c: Pick<PartnerConnection, "settings" | "provider">, a: Adapter, ev: JrEvent) => a.capabilities.push.includes(ev) && !!settingsOf(c, a).sync[ev];

// ───────── URLs JR hands to partners ─────────
const app = () => env.appUrl.replace(/\/$/, "");
export const hookUrl = (id: string) => `${app()}/api/v1/integrations/hooks/${id}`;
export const hookUrlWithToken = (id: string, token: string) => `${hookUrl(id)}/${token}`;
export const carrierBaseUrl = (provider: string) => `${app()}/api/v1/carriers/${provider}`;
export const labelUrl = (awb: string) => `${app()}/api/v1/integrations/labels/${encodeURIComponent(awb)}/${labelSig(awb)}/label.pdf`;
export const trackingUrl = (ref: string) => `${app()}/track/${encodeURIComponent(ref)}`;

/** Everything an adapter call needs. Rotated secrets / runtime state are written straight back (encrypted / jsonb merge). */
export function ctxOf(c: PartnerConnection): Ctx {
  const secrets = decryptSecrets(c.secretsEnc);
  const meta: Record<string, unknown> = { ...((c.meta ?? {}) as Record<string, unknown>) };
  return {
    connectionId: c.id, config: (c.config ?? {}) as Ctx["config"], secrets, meta, http: partnerHttp, appUrl: app(),
    saveSecrets: async (patch) => {
      Object.assign(secrets, patch);
      // Re-read under a row lock so two concurrent refreshes never drop each other's other secrets.
      await db.transaction(async (tx) => {
        const [row] = await tx.select({ s: partnerConnections.secretsEnc }).from(partnerConnections).where(eq(partnerConnections.id, c.id)).for("update");
        await tx.update(partnerConnections).set({ secretsEnc: encryptSecrets({ ...decryptSecrets(row?.s ?? null), ...patch }) }).where(eq(partnerConnections.id, c.id));
      });
    },
    lock: (fn) => db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"partner-conn:" + c.id}))`); return fn(); }),
    reloadSecrets: async () => { const [row] = await db.select({ s: partnerConnections.secretsEnc }).from(partnerConnections).where(eq(partnerConnections.id, c.id)); return decryptSecrets(row?.s ?? null); },
    saveMeta: async (patch) => {
      Object.assign(meta, patch);
      await db.update(partnerConnections).set({ meta: sql`${partnerConnections.meta} || ${JSON.stringify(patch)}::jsonb` }).where(eq(partnerConnections.id, c.id));
    },
  };
}
