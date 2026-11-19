"use client";
import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { useT } from "@/i18n/provider";

const subscribe = (cb: () => void) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; };
/** Browser connectivity (true on the server so the first paint never flashes a banner). */
export function useOnline() { return useSyncExternalStore(subscribe, () => navigator.onLine, () => true); }

/** Sticky strip under the header while the device has no connection: what is on screen is the last saved state, nothing typed is lost. */
export function OfflineBanner() {
  const t = useT(); const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-16 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-gold/40 bg-bg2/95 px-4 py-2.5 text-sm font-medium text-gold backdrop-blur sm:-mx-6 sm:px-6" data-testid="offline-banner">
      <WifiOff className="size-4 shrink-0" aria-hidden /><span>{t("ux.d_offline")}</span>
    </div>
  );
}
