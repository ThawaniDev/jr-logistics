import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Tajawal } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/core";
import { dictionaries } from "@/i18n/dictionaries";
import { I18nProvider } from "@/i18n/provider";
import { HydrationFlag } from "@/components/hydration-flag";

const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-plex", display: "swap" });
const tajawal = Tajawal({ subsets: ["arabic", "latin"], weight: ["500", "700", "800"], variable: "--font-tajawal", display: "swap" });

export const metadata: Metadata = {
  title: { default: "JR Logistics", template: "%s · JR Logistics" },
  description: "Saudi logistics marketplace — delivery drivers, vehicles with and without driver, courier offices.",
  icons: { icon: "/jr-logo-mark.png" },
};
export const viewport: Viewport = { themeColor: "#0B132B", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dir = dirOf(locale);
  return (
    <html lang={locale} dir={dir} className={`${plex.variable} ${tajawal.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">Skip to content</a>
        <HydrationFlag />
        <I18nProvider locale={locale} dict={dictionaries[locale]} fallback={dictionaries.en}>
          {children}
          <Toaster theme="dark" position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} toastOptions={{ style: { background: "var(--jr-card)", border: "1px solid var(--jr-line)", color: "var(--jr-text)" } }} />
        </I18nProvider>
      </body>
    </html>
  );
}
