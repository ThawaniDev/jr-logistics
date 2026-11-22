import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isThemeMode, parseThemeMode, resolveTheme, themeCookie, THEME_COLOR, THEME_COOKIE, THEME_INIT_SCRIPT, THEME_KEY, THEME_MODES } from "@/lib/theme";

describe("theme modes", () => {
  it("offers system / light / dark and defaults to system", () => {
    expect([...THEME_MODES]).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME).toBe("system");
  });

  it("parses the cookie value: only the three modes are accepted, anything else is the default", () => {
    for (const m of THEME_MODES) { expect(isThemeMode(m)).toBe(true); expect(parseThemeMode(m)).toBe(m); }
    for (const bad of [undefined, null, "", "auto", "LIGHT", "dark ", 1, {}]) { expect(isThemeMode(bad)).toBe(false); expect(parseThemeMode(bad)).toBe("system"); }
  });

  it("resolves: explicit modes win, system follows the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("the cookie lasts a year, applies to every path and is not cross-site", () => {
    expect(themeCookie("light")).toBe("jr_theme=light; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(THEME_COOKIE).toBe("jr_theme");
    expect(THEME_KEY).toBe("jr_theme");
  });

  it("the browser chrome colours are the page backgrounds of the two themes", () => {
    expect(THEME_COLOR).toEqual({ light: "#f6f8fb", dark: "#0b132b" });
  });

  it("the init script only reads localStorage and only touches data-theme when the server had no cookie", () => {
    expect(THEME_INIT_SCRIPT.length).toBeLessThan(400);
    expect(THEME_INIT_SCRIPT).toContain('data-theme-src")!=="cookie"');
    expect(THEME_INIT_SCRIPT).toContain(`localStorage.getItem("${THEME_KEY}")`);
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
  });
});
