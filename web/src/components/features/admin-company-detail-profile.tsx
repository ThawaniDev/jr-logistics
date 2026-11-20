"use client";
import Link from "next/link";
import { History } from "lucide-react";
import { Badge, EmptyState, ErrorState, InfoGrid, Section, Skeleton, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useCompany } from "./admin-companies-ctx";

interface Profile {
  taxNumber: string | null; crNumber: string | null; industry: string | null; address: string | null; responsiblePerson: string | null; language: string; source: string; isDemo: boolean; createdAt: string;
  createdBy: { id: string; name: string; role: string } | null; contact: { phone: string | null; email: string | null; city: string | null };
  lastLoginAt: string | null; lastSeenAt: string | null; loginCount: number; lastLoginClient: string | null;
  verification: { status: string; note: string | null }; history: Array<{ id: string; at: string; action: string; actor: { id: string; name: string | null } | null; note: string | null; docType: string | null }> | null;
}
const LANG: Record<string, string> = { ar: "العربية", en: "English", ur: "اردو" };

/** Profile facts of the company (registration and VAT numbers, contact, how the account came to exist, last sign-in) and the verification history with who decided what. */
export function CompanyProfileFacts() {
  const { t, locale } = useI18n(); const me = useUser(); const c = useCompany(); const tx = useTx();
  const { data: p, error, mutate } = useApi<Profile>(`/admin/companies/${c.id}/profile`, { shouldRetryOnError: false });
  if (error) return <Section title={t("dv3.profile_title")}><ErrorState error={error} retry={() => mutate()} /></Section>;
  const num = (v?: string | null) => (v ? <span className="ltr-num" dir="ltr">{v}</span> : "—");
  return (
    <>
      <Section title={t("dv3.profile_title")} description={t("dv3.profile_sub")}>
        {!p ? <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
          <div data-testid="dv3-profile">
            <InfoGrid cols={3} items={[
              { label: t("reg.cr"), value: <span data-testid="dv3-fact-cr">{num(p.crNumber)}</span> },
              { label: t("reg.tax"), value: <span data-testid="dv3-fact-tax">{num(p.taxNumber)}</span> },
              { label: t("reg.industry"), value: p.industry ?? "—" },
              { label: t("rdp.fact_contact"), value: p.responsiblePerson ?? c.contactName },
              { label: t("auth.phone"), value: num(p.contact.phone) },
              { label: t("auth.email"), value: p.contact.email ? <span dir="ltr" className="ltr-num break-all">{p.contact.email}</span> : "—" },
              { label: t("reg.city"), value: p.contact.city ? tx(`city.${p.contact.city}`, p.contact.city) : "—" },
              { label: t("rdp.fact_address"), value: p.address ?? "—" },
              { label: t("acr.language"), value: LANG[p.language] ?? p.language },
              { label: t("dv3.f_source"), value: <span className="inline-flex flex-wrap items-center gap-1.5">{t(`dv3.src_${p.source}`)}{p.isDemo && <Badge>{t("dv3.demo")}</Badge>}</span> },
              { label: t("dv3.f_created_by"), value: p.createdBy ? (hasPerm(me, "staff.view") || hasPerm(me, "staff.manage") ? <Link href={`/admin/users/${p.createdBy.id}`} className="text-accent hover:underline" data-testid="dv3-created-by">{p.createdBy.name}</Link> : p.createdBy.name) : "—" },
              { label: t("rdp.fact_joined"), value: fmtDateTime(p.createdAt, locale) },
              { label: t("dv3.f_last_login"), value: p.lastLoginAt ? <span>{fmtDateTime(p.lastLoginAt, locale)}{p.lastLoginClient && <span className="text-muted"> · {t(`dv3.client_${p.lastLoginClient}`)}</span>}</span> : t("dv3.never") },
              { label: t("dv3.f_last_seen"), value: p.lastSeenAt ? fmtDateTime(p.lastSeenAt, locale) : "—" },
              { label: t("dv3.f_logins"), value: <span className="ltr-num">{fmtNum(p.loginCount, locale)}</span> },
            ]} />
          </div>)}
      </Section>
      {p?.history && (
        <Section title={<span className="inline-flex items-center gap-2"><History className="size-4 text-muted" aria-hidden />{t("dv3.vh_title")}</span>} description={t("dv3.vh_sub")}>
          {p.history.length === 0 ? <EmptyState title={t("dv3.vh_empty")} /> : (
            <ol className="relative space-y-3 border-s border-line ps-5" data-testid="dv3-verification-history">
              {p.history.map((h) => (
                <li key={h.id} className="relative" data-testid="dv3-vh-item">
                  <span className="absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full bg-muted/60 ring-4 ring-card" aria-hidden />
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">{tx(`dtk.act.${h.action}`, h.action)}{h.docType && <Badge>{tx(`doc.${h.docType}`, h.docType)}</Badge>}</p>
                  {h.note && <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">{h.note}</p>}
                  <p className="mt-1 text-[11px] text-muted"><span>{fmtDate(h.at, locale)}</span> · {h.actor?.name ?? t("dv3.system")}</p>
                </li>))}
            </ol>)}
        </Section>)}
      {p && !p.history && p.verification.note && <Section title={t("dv3.vh_title")}><p className="text-sm"><StatusBadge status={p.verification.status} /> <span className="ms-2 text-muted">{p.verification.note}</span></p></Section>}
    </>
  );
}
