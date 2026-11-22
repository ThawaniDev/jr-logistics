"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { isThemeMode, resolveTheme, themeCookie, THEME_COLOR, THEME_COOKIE, THEME_KEY, type ResolvedTheme, type ThemeMode } from "@/lib/theme";

interface ThemeCtx { mode: ThemeMode; resolved: ResolvedTheme; setMode: (m: ThemeMode) => void }
const Ctx = createContext<ThemeCtx | null>(null);

// The choice of this device lives in localStorage (so tabs stay in sync) and in the cookie (so the server paints the right theme on the next request).
// Where storage is blocked (private mode) the choice lasts in memory until the page is reloaded; the cookie still carries it.
const EVENT = "jr:theme";
let memory: ThemeMode | null = null;
function readStored(): ThemeMode | null {
  try { const v = localStorage.getItem(THEME_KEY); if (isThemeMode(v)) return v; } catch { /* blocked */ }
  return memory;
}
const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener(EVENT, cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVENT, cb); }; };
const DARK_QUERY = "(prefers-color-scheme: dark)";
const subscribeSystem = (cb: () => void) => { const q = window.matchMedia(DARK_QUERY); q.addEventListener("change", cb); return () => q.removeEventListener("change", cb); };

/** `initial` is the cookie value the server painted with. */
export function ThemeProvider({ initial, children }: { initial: ThemeMode; children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const systemDark = useSyncExternalStore(subscribeSystem, () => window.matchMedia(DARK_QUERY).matches, () => true);
  const mode = stored ?? initial;
  const resolved = resolveTheme(mode, systemDark);

  // keep <html>, the cookie and the browser chrome colour in line with the choice (this also heals a missing cookie from localStorage)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    if (stored && !document.cookie.split("; ").includes(`${THEME_COOKIE}=${stored}`)) document.cookie = themeCookie(stored);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[resolved]));
  }, [mode, resolved, stored]);

  const setMode = useCallback((m: ThemeMode) => {
    memory = m;
    try { localStorage.setItem(THEME_KEY, m); } catch { /* blocked: memory + cookie carry it */ }
    document.documentElement.setAttribute("data-theme", m);
    document.cookie = themeCookie(m);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
