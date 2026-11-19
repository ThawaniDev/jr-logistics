"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { pickNewOffers, trimSeen } from "./driver-fieldops-utils";
import { signal, unlockAudio } from "./driver-feedback";

/**
 * E12 — new job offers while the app is open. Polls the unread notifications (~20 s while the tab is visible), and for every `offer_new` this device
 * has not announced yet: a toast + sound/vibration, a browser Notification when the driver allowed them, and an unread count in the tab title.
 * True background push (app closed) needs FCM/APNs credentials — owner item.
 */
const SEEN_KEY = "jr.fieldops.seenOfferNotifs";
const ASK_KEY = "jr.fieldops.notifAsk";
const OFFERS_HREF = "/driver/opportunities"; // the driver's offers list lives here
const memSeen = new Set<string>(); // survives a storage that is unavailable (private mode), for this page session

const readSeen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const writeSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(trimSeen(ids))); } catch { /* storage unavailable: the in-memory set still de-duplicates */ } };
const askState = () => { try { return localStorage.getItem(ASK_KEY); } catch { return null; } };

type Perm = NotificationPermission | "unsupported";
const noop = () => () => {};
const permNow = (): Perm => (typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission);

interface NotifRow { id: string; type: string; createdAt?: string | null; data?: Record<string, unknown> | null }

export function DriverAlerts() {
  const { t } = useI18n(); const router = useRouter();
  const initial = useSyncExternalStore(noop, permNow, () => "unsupported" as Perm);
  const [perm, setPerm] = useState<Perm | null>(null);
  const [asked, setAsked] = useState<string | null | undefined>(undefined);
  const permission = perm ?? initial;
  const decided = asked === undefined ? askState() : asked; // read lazily on the client: this component renders only after hydration of the shell
  const tRef = useRef(t); const routerRef = useRef(router);
  useEffect(() => { tRef.current = t; routerRef.current = router; });
  useEffect(() => { unlockAudio(); }, []);

  const announce = (rows: NotifRow[]) => {
    const tt = tRef.current; const go = () => routerRef.current.push(OFFERS_HREF);
    const city = (k: unknown) => { const key = String(k ?? ""); const v = tt(`city.${key}`); return v.startsWith("city.") ? key : v; };
    const text = (n: NotifRow) => { const d = n.data ?? {}; return tt("notif.offer_new", { ref: String(d.ref ?? ""), parcels: String(d.parcels ?? ""), pickupCity: city(d.pickupCity), deliveryCity: city(d.deliveryCity) }); };
    signal("alert");
    if (rows.length === 1) toast(text(rows[0]), { id: `offer-${rows[0].id}`, duration: 20_000, action: { label: tt("fod.alert_view"), onClick: go } });
    else toast(tt("fod.alert_many", { n: rows.length }), { id: "offer-many", duration: 20_000, action: { label: tt("fod.alert_view"), onClick: go } });
    if (permNow() === "granted") {
      for (const n of rows.slice(0, 3)) {
        try {
          const note = new Notification(tt("fod.alert_title"), { body: text(n), tag: `offer-${n.id}`, icon: "/jr-logo-mark.png" });
          note.onclick = () => { window.focus(); go(); note.close(); };
        } catch { /* some mobile browsers only allow notifications through a service worker: the toast and sound still fired */ }
      }
    }
  };

  const { data } = useSWR<{ items: NotifRow[]; unread: number }>("/notifications?unread=1&unreadOnly=1", fetcher, {
    refreshInterval: () => (typeof document === "undefined" || document.visibilityState === "visible" ? 20_000 : 0),
    revalidateOnFocus: true, revalidateOnReconnect: true,
    onSuccess: (res) => {
      const seen = new Set([...readSeen(), ...memSeen]);
      const { alert, mark } = pickNewOffers(res?.items, seen);
      if (!mark.length) return;
      mark.forEach((id) => memSeen.add(id)); writeSeen([...readSeen(), ...mark]);
      if (alert.length) { announce(alert); void globalMutate("/notifications?unread=1"); } // let the header bell catch up at once
    },
  });

  // The unread count in the tab title. The shell rewrites the title on every navigation, so the prefix is re-applied when it does.
  const unread = data?.unread ?? 0;
  useEffect(() => {
    const strip = (s: string) => s.replace(/^\(\d+\+?\)\s/, "");
    const apply = () => { const base = strip(document.title); const want = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base; if (document.title !== want) document.title = want; };
    apply();
    const el = document.querySelector("title"); if (!el) return () => { document.title = strip(document.title); };
    const mo = new MutationObserver(apply); mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => { mo.disconnect(); document.title = strip(document.title); };
  }, [unread]);

  const enable = async () => {
    try { const r = await Notification.requestPermission(); setPerm(r); } catch { setPerm(permNow()); }
    try { localStorage.setItem(ASK_KEY, "answered"); } catch { /* ignore */ } setAsked("answered");
  };
  const dismiss = () => { try { localStorage.setItem(ASK_KEY, "dismissed"); } catch { /* ignore */ } setAsked("dismissed"); };

  if (permission !== "default" || decided) return null;
  return (
    <Card data-testid="notif-permission-banner" className="mb-4 flex flex-wrap items-center justify-between gap-3 border-cyan/40 bg-cyan/5 p-4">
      <p className="flex min-w-0 flex-1 basis-60 items-start gap-2 text-sm"><BellRing className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />{t("fod.alert_ask")}</p>
      <div className="flex gap-2"><Button data-testid="notif-enable" size="lg" onClick={enable}>{t("fod.alert_enable")}</Button><Button data-testid="notif-dismiss" size="lg" variant="ghost" className="border border-line" onClick={dismiss}>{t("fod.alert_later")}</Button></div>
    </Card>
  );
}
