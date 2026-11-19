"use client";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { type SWRConfiguration } from "swr";
import { fetcher } from "@/lib/api";
export function useApi<T = any>(path: string | null, cfg?: SWRConfiguration) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...cfg });
}

// Setters called in the same tick (a "Clear filters" button resetting three filters) are merged into ONE router.replace; otherwise each replace would
// start from the same stale query and the last one would silently undo the others.
let pending: Record<string, string> | null = null;
/**
 * Sets URL params (`{ status: "open", q: "" }`; an empty value removes the param). Calls made in the same tick are batched into one `router.replace`.
 * Reads the current query at flush time, so changes made one after the other accumulate. The page param resets to the first page.
 */
export function useUrlPatch(): (patch: Record<string, string>) => void {
  const router = useRouter(); const path = usePathname();
  return useCallback((patch: Record<string, string>) => {
    const first = pending === null;
    pending = { ...(pending ?? {}), ...patch };
    if (!first) return;
    queueMicrotask(() => {
      const p = pending ?? {}; pending = null;
      const q = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(p)) { if (v) q.set(k, v); else q.delete(k); }
      q.delete("page");
      const s = q.toString();
      router.replace(s ? `${path}?${s}` : path, { scroll: false });
    });
  }, [path, router]);
}

/**
 * A filter that lives in the URL (`?status=in_progress`), so a dashboard tile, a notification or a copied link opens the list already filtered
 * and the back button undoes a filter change. The value equal to `initial` is not written (clean URLs). Uses `router.replace` without scrolling.
 * Needs a <Suspense> boundary above it (it reads `useSearchParams`). For free-text search keep local state + a debounce instead.
 * Several filters changed in the same tick are batched into one URL update.
 */
export function useUrlState(key: string, initial = ""): [string, (v: string) => void] {
  const sp = useSearchParams(); const patch = useUrlPatch();
  const value = sp.get(key) ?? initial;
  const set = useCallback((v: string) => patch({ [key]: v && v !== initial ? v : "" }), [patch, key, initial]);
  return [value, set];
}
