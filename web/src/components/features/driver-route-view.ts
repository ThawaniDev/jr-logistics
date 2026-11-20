"use client";
import { useSyncExternalStore } from "react";

/** List | Map choice of the route stages (routing on). Remembered on this device and shared between the page header's route button and the tab switch. */
export type RouteView = "list" | "map";
const KEY = "jr.driver.routeView";
const EVENT = "jr:routeview";

let memory: RouteView = "list"; // used when the browser refuses storage (private mode)
const read = (): RouteView => { try { return localStorage.getItem(KEY) === "map" ? "map" : "list"; } catch { return memory; } };
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb); window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
};

export function setRouteView(v: RouteView) {
  memory = v;
  try { localStorage.setItem(KEY, v); } catch { /* private mode: `memory` and the event below still switch this tab */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Server render and the first client render say "list" (no hydration mismatch); the saved choice applies right after. */
export function useRouteView(): [RouteView, (v: RouteView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => "list" as RouteView);
  return [view, setRouteView];
}
