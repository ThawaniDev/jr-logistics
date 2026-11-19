import Link from "next/link";
import { Logo, LanguageSwitcher } from "@/components/layout/shell";
import { getT } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getT();
  return (
    <div className="relative min-h-dvh bg-bg text-ink hero-grid-pattern selection:bg-accent/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-28 start-1/3 size-[500px] rounded-full bg-cyan/10 blur-[150px]" />
        <div className="absolute -bottom-28 end-1/4 size-[400px] rounded-full bg-accent/10 blur-[150px]" />
      </div>
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Link href="/" aria-label={t("ux.d_home")}>
          <Logo size={34} />
        </Link>
        <LanguageSwitcher compact />
      </header>
      <main id="main" className="relative z-10 mx-auto flex max-w-6xl justify-center px-4 pb-20 pt-2 sm:px-5 sm:pt-4">
        {children}
      </main>
    </div>
  );
}
