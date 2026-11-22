import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Tajawal } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/core";
import { dictionaries } from "@/i18n/dictionaries";
import { I18nProvider } from "@/i18n/provider";
import { HydrationFlag } from "@/components/hydration-flag";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import { getTheme } from "@/lib/theme-server";
import { THEME_COLOR, THEME_INIT_SCRIPT } from "@/lib/theme";

const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-plex", display: "swap" });
const tajawal = Tajawal({ subsets: ["arabic", "latin"], weight: ["500", "700", "800"], variable: "--font-tajawal", display: "swap" });

export const metadata: Metadata = {
  title: { default: "JR Logistics", template: "%s · JR Logistics" },
  description: "Saudi logistics marketplace — delivery drivers, vehicles with and without driver, courier offices.",
  icons: { icon: "/jr-logo-mark.png" },
};
/** The browser chrome colour follows the visitor's choice; `system` hands the decision to the OS. */
export async function generateViewport(): Promise<Viewport> {
  const { mode } = await getTheme();
  const themeColor = mode === "system" ? [{ media: "(prefers-color-scheme: light)", color: THEME_COLOR.light }, { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark }] : THEME_COLOR[mode];
  return { themeColor, width: "device-width", initialScale: 1 };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dir = dirOf(locale);
  const { mode, fromCookie } = await getTheme();
  return (
    <html lang={locale} dir={dir} data-theme={mode} data-theme-src={fromCookie ? "cookie" : "default"} className={`${plex.variable} ${tajawal.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">{dictionaries[locale]["a11y.skip"] ?? dictionaries.en["a11y.skip"]}</a>
        <HydrationFlag />
        <ThemeProvider initial={mode}>
          <I18nProvider locale={locale} dict={dictionaries[locale]} fallback={dictionaries.en}>
            {children}
            <ThemedToaster dir={dir} />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
