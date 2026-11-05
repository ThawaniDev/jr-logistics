import Link from "next/link";
import { getT } from "@/i18n/server";
import { Logo } from "@/components/layout/shell";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="bg-hero flex min-h-dvh flex-col items-center justify-center gap-5 px-5 text-center">
      <Logo /><p className="text-7xl font-black text-gradient">404</p><h1 className="text-2xl font-bold">{t("err.page_not_found")}</h1><p className="max-w-sm text-muted">{t("err.page_not_found_hint")}</p>
      <Link href="/" className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-ink">{t("err.go_home")}</Link>
    </div>
  );
}
