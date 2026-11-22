import { cookies } from "next/headers";
import { isThemeMode, parseThemeMode, THEME_COOKIE, type ThemeMode } from "./theme";

/** The visitor's theme choice from the `jr_theme` cookie (`system` when there is none). `fromCookie` tells the first paint whether a stored choice may still override it. */
export async function getTheme(): Promise<{ mode: ThemeMode; fromCookie: boolean }> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return { mode: parseThemeMode(v), fromCookie: isThemeMode(v) };
}
