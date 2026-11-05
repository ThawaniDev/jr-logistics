"use client";
import useSWR, { type SWRConfiguration } from "swr";
import { fetcher } from "@/lib/api";
export function useApi<T = any>(path: string | null, cfg?: SWRConfiguration) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...cfg });
}
