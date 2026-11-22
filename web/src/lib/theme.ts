/**
 * Theme modes (pure, no React / no Next): the cookie `jr_theme` is read on the server (no flash: `<html data-theme>` is right in the first byte of the HTML),
 * `localStorage.jr_theme` is the same choice on this device, and `system` follows the OS (CSS media query, so it needs no script and follows live changes).
 */
export const THEME_COOKIE = "jr_theme";
export const THEME_KEY = "jr_theme";
export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = "light" | "dark";
export const DEFAULT_THEME: ThemeMode = "system";

export const isThemeMode = (v: unknown): v is ThemeMode => typeof v === "string" && (THEME_MODES as readonly string[]).includes(v);
/** An unknown / missing value is the default (`system`). */
export const parseThemeMode = (v: unknown): ThemeMode => (isThemeMode(v) ? v : DEFAULT_THEME);
/** The theme that is actually shown: `system` is whatever the OS prefers. */
export const resolveTheme = (mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme => (mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode);
/** The `Set-Cookie`-style value written by the browser (one year, readable on every page, sent with first-party navigation only). */
export const themeCookie = (mode: ThemeMode) => `${THEME_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** Browser chrome colour (`<meta name="theme-color">`): the `--jr-bg` of each theme. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#f6f8fb", dark: "#0b132b" };

/**
 * Runs in `<head>` before the first paint. The server already wrote `data-theme` from the cookie; this only matters when the cookie is missing (cleared) but this device
 * remembers a choice in localStorage: it then applies it before anything is painted. `data-theme-src="cookie"` means the server had a cookie, which always wins.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,m=localStorage.getItem("${THEME_KEY}");if(d.getAttribute("data-theme-src")!=="cookie"&&(m==="light"||m==="dark"||m==="system"))d.setAttribute("data-theme",m)}catch(e){}})()`;
