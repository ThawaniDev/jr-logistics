"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { errText } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useT } from "@/i18n/provider";

type TFn = (k: string, v?: Record<string, string | number>) => string;

/**
 * A readable message for any failed request. Drivers work with weak signal: a request that never reached the server
 * must say so (and that nothing was lost), instead of a vague "something went wrong on our side".
 */
export function friendlyErr(e: unknown, t: TFn): string {
  if (!(e instanceof ApiError)) return t(typeof navigator !== "undefined" && navigator.onLine === false ? "ux.d_err_offline" : "ux.d_err_network");
  if (e.code === "INTERNAL" && e.status >= 502 && e.status <= 504) return t("ux.d_err_unavailable");
  return errText(e, t);
}

/**
 * Same contract as the ui-kit `useAction`, plus: (1) a synchronous re-entry lock so a double tap / a second Enter can never send
 * the same money or state action twice, (2) network failures are explained (see friendlyErr).
 */
export function useDriverAction() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  async function run<T>(key: string, fn: () => Promise<T>, o: { success?: string; onDone?: (r: T) => void; onError?: (e: unknown) => void } = {}) {
    if (lock.current) return undefined;
    lock.current = true; setBusy(key);
    try {
      const r = await fn();
      if (o.success) toast.success(t(o.success));
      o.onDone?.(r);
      return r;
    } catch (e) {
      toast.error(friendlyErr(e, t));
      o.onError?.(e);
    } finally { lock.current = false; setBusy(null); }
  }
  return { busy, run, is: (k: string) => busy === k, any: busy !== null };
}
