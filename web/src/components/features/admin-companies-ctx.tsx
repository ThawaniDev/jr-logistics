"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { useSWRConfig } from "swr";
import { isCompanyKey } from "./admin-companies-lib";

/** The company the detail layout loaded once; every tab reads it from here instead of fetching it again. */
export interface Company {
  id: string; name: string; contactName: string; phone: string | null; email: string | null; city: string | null; status: string; createdAt: string;
  profile: {
    crNumber: string | null; industry: string | null; address: string | null; responsiblePerson: string | null; verificationStatus: string; verificationNote: string | null;
    warehouse: { lat: number; lng: number } | null; rating: number | null; ratingCount: number; hasWebhook: boolean;
  };
  counts: { orders: number | null; docsToReview: number | null };
}
const Ctx = createContext<Company | null>(null);
export const CompanyProvider = Ctx.Provider;
export function useCompany() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCompany outside CompanyProvider");
  return c;
}

/** Revalidates every cached company / verification / document list after an action changed an account (header, lists, queue badges). */
export function useRefreshCompanies() {
  const { mutate } = useSWRConfig();
  return useCallback(() => mutate(isCompanyKey), [mutate]);
}

/** A page number that falls back to 1 whenever the filter `key` changes (no effect needed: the page is remembered together with the key it belongs to). */
export function usePageFor(key: string): [number, (p: number) => void] {
  const [s, set] = useState({ key, page: 1 });
  return [s.key === key ? s.page : 1, (page) => set({ key, page })];
}
