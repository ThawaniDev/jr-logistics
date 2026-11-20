"use client";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { errText } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api";
import { fileNameFrom } from "./fleet-lib";

/**
 * Downloads a generated file (an `.xlsx` / CSV of a table, the workbook of an entity): fetched with the session cookie, so a refusal or a timeout shows a toast in the viewer's
 * language instead of saving an error page as a file, and `busy` names the file being prepared (a workbook takes a few seconds). The file name comes from `Content-Disposition`.
 * Only one file is prepared at a time.
 */
export interface Downloader { busy: string | null; run: (key: string, url: string, fallbackName: string) => void }
export function useDownload(): Downloader {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, url: string, fallbackName: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        let e: { code?: string; message?: string; details?: Record<string, unknown> } | undefined;
        try { e = JSON.parse(await res.text())?.error; } catch { /* not JSON */ }
        throw new ApiError(e?.code ?? "INTERNAL", e?.message ?? res.statusText, res.status, e?.details ?? {});
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href; a.download = fileNameFrom(res.headers.get("content-disposition"), fallbackName); a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch (e) {
      toast.error(errText(e, t));
    } finally {
      setBusy(null);
    }
  }, [busy, t]);
  return { busy, run };
}
