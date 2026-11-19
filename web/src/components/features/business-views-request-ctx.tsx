"use client";
import { createContext, useContext } from "react";
import type { ShipmentPage } from "./business-shipments-lib";
import type { SupportLink } from "./support";

export type ModalKind = null | { kind: "cancel" | "discard" | "publish" } | { kind: "urgent"; offer?: any } | { kind: "noshow" | "loading" | "custody" | "rate" | "handover" | "returns" | "cash"; offer: any };
export type OpenModal = (kind: NonNullable<ModalKind>["kind"], offer?: any, init?: Record<string, unknown>) => void;

/** What every section of one order (overview, parcels, money, activity) needs, loaded once by the order's layout. */
export interface RequestCtx {
  id: string; base: string;
  data: any; r: any; offers: any[]; manifest: boolean; ship: ShipmentPage | undefined;
  incomplete: number; undelivered: number; live: boolean; blocked: boolean; cat: any;
  mutate: () => void; refreshShipments: () => Promise<unknown>;
  open: OpenModal; act: (key: string, path: string, body: unknown, success?: string) => void; busy: (key: string) => boolean;
  openReport: (link: SupportLink) => void; openComplete: () => void;
}
const Ctx = createContext<RequestCtx | null>(null);
export const RequestProvider = Ctx.Provider;
export function useRequest(): RequestCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRequest outside the order layout");
  return c;
}

/** Offers where the driver can no longer scan or be waited for: no loading progress to show. */
export const NO_LOADING = ["offered", "rejected", "expired", "cancelled", "no_show", "replaced"];
export const ACTIVE_OFFER = ["accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed"];
export const UNDELIVERED = ["failed", "returned", "missing", "cancelled"];
/** Fields a draft must have before it can be published (a missing one is highlighted after a refused publish). */
export const publishFields = (service: string): Array<[string, string]> => [["pickupAddress", "wizard.pickup_address"], ...(service === "delivery_driver" ? [["shipments", "bs.step_shipments"] as [string, string]] : [["deliveryAddress", "wizard.delivery_address"] as [string, string]]), ["startsAt", "wizard.starts"]];
