"use client";
import useSWR, { type SWRConfiguration } from "swr";
import { get } from "@/lib/api";

interface Paged<T> { items: T[]; total: number; pageSize: number }
/**
 * Every row of a paged office list (jobs, settlements). The office APIs page at 50 rows, but the views filter, count and search across the whole
 * list; this loads page 1, then the remaining pages in parallel (at most `max`, so a huge history can never stall the screen).
 * `truncated` is true when rows beyond the cap exist. Refreshing re-reads everything and the key is shared, so several widgets cost one fetch.
 */
export function useAllRows<T>(path: string | null, cfg: SWRConfiguration & { max?: number } = {}) {
  const { max = 20, ...swr } = cfg;
  return useSWR<{ items: T[]; total: number; truncated: boolean }>(path ? ["office-all", path] : null, async () => {
    const url = (p: number) => `${path}${path!.includes("?") ? "&" : "?"}page=${p}`;
    const first = await get<Paged<T>>(url(1));
    const pages = Math.min(Math.ceil(first.total / Math.max(first.pageSize, 1)), max);
    const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get<Paged<T>>(url(i + 2)))) : [];
    const items = [first, ...rest].flatMap((p) => p.items);
    return { items, total: first.total, truncated: items.length < first.total };
  }, { revalidateOnFocus: false, ...swr });
}
