import { getT } from "@/i18n/server";

const SECTIONS = ["collect", "use", "share", "location", "whatsapp", "rights"] as const;

/** What the platform actually does with personal data. Wording is a DRAFT until the owner's legal review (see DECISIONS.md). */
export default async function PrivacyPage() {
  const { t } = await getT();
  return (
    <article className="w-full max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold">{t("legal.privacy_title")}</h1>
        <p className="mt-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold">{t("legal.draft_notice")}</p>
      </header>
      {SECTIONS.map((k) => (
        <section key={k} className="rounded-card border border-line bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">{t(`legal.p_${k}_h`)}</h2>
          <p className="text-sm leading-7 text-muted">{t(`legal.p_${k}`)}</p>
        </section>
      ))}
    </article>
  );
}
