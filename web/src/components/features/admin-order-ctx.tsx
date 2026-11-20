"use client";
import { createContext, useCallback, useContext } from "react";
import { useSWRConfig } from "swr";

/** What every section of one order needs, loaded once by the order's layout: the id, the overview payload (header facts, KPIs, flags, access) and a refresh for everything about this order. */
export interface OrderCtx { id: string; data: any; refresh: () => Promise<unknown>; openModal: (m: "assign" | "cancel") => void }
const Ctx = createContext<OrderCtx | null>(null);
export const OrderProvider = Ctx.Provider;
export function useOrder(): OrderCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrder outside the order layout");
  return c;
}

/** Revalidates every cached read about this order (summary, offers, parcels, money, chat, activity, notes) after an action changed it. */
export function useRefreshOrder(id: string) {
  const { mutate } = useSWRConfig();
  return useCallback(() => mutate((k) => typeof k === "string" && k.includes(id)), [mutate, id]);
}
