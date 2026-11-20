"use client";
import { useApi } from "@/components/ui/data";

/** The platform's B2B switch (`GET /catalog` → `policy.b2bShipmentsEnabled`, update J3). */
export const b2bEnabledOf = (cat: { policy?: { b2bShipmentsEnabled?: unknown } } | null | undefined): boolean =>
  // not loaded yet: assume OFF (a recipient-type choice must never flash up and vanish); a server without the flag = the original behaviour (on)
  cat ? cat.policy?.b2bShipmentsEnabled !== false : false;

/**
 * Whether the recipient-type choice (individual / business) exists at all. Off → no selector and no type column anywhere in the manifest, imports and
 * edit dialogs; every parcel is an individual (B2C) and `recipientType` is never sent as "business" (the API would refuse it with `B2B_DISABLED`).
 */
export function useB2bEnabled(): boolean {
  const { data } = useApi<{ policy?: { b2bShipmentsEnabled?: unknown } }>("/catalog");
  return b2bEnabledOf(data);
}
