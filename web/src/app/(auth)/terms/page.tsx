import { getT } from "@/i18n/server";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic"; // terms are editable by the owner in Admin → Settings

/** Public terms of use: the exact text each role accepts at registration, with its version. */
export default async function TermsPage() {
  const { t } = await getT();
  const s = await getSettings();
  const parts = [["business", s.termsBusiness], ["driver", s.termsDriver], ["office", s.termsOffice]] as const;
  return (
    <article className="w-full max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold">{t("legal.terms_title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("legal.version", { v: s.termsVersion })}</p>
      </header>
      {parts.map(([role, text]) => (
        <section key={role} className="rounded-card border border-line bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">{t(`role.${role}`)}</h2>
          <p className="whitespace-pre-line text-sm leading-7 text-muted">{text}</p>
        </section>
      ))}
    </article>
  );
}
