"use client";
import { useState } from "react";
import { Handshake } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Notice, PageLoading, Section, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny } from "./admin-common";
import { SendAgreementModal } from "./admin-offices-actions";
import { AgreementBadge } from "./admin-offices-common";
import { agreementView, isPast } from "./admin-offices-lib";

/** Agreements of one office (newest five, `GET /admin/offices/:id/agreements`) and the "send agreement" form (`POST`, needs `offices.manage`). */
export function OfficeAgreementsTab({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const [open, setOpen] = useState(false);
  const canView = hasAny(me, "offices.view"), canSend = hasPerm(me, "offices.manage");
  const office = useApi(`/admin/offices/${id}`);
  const { data, error, mutate } = useApi(canView ? `/admin/offices/${id}/agreements` : null);
  if (!canView) return <Notice tone="warn">{t("rdq.no_access")}</Notice>;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const items: any[] = data.items;
  const accepted = items.find((a) => a.status === "accepted"); const latest = items[0];
  const view = agreementView(latest?.status, latest?.expiresAt);
  const send = canSend && <Button size="sm" data-testid="rdq-agreements-send" onClick={() => setOpen(true)}><Handshake className="size-4" aria-hidden />{t("admin.send_agreement")}</Button>;
  const done = () => { mutate(); office.mutate(); };
  return (
    <div className="space-y-5">
      <StatGrid cols={3}>
        <Stat label={t("rdq.agr_current")} value={t(view.label)} hint={latest ? t("office.agreement_v", { v: latest.version }) : t("office.no_agreement_hint")} tone={view.tone === "success" ? "accent" : view.tone === "warn" ? "gold" : view.tone === "danger" ? "danger" : "muted"} icon={<Handshake className="size-5" />} />
        <Stat label={t("rdq.agr_accepted_on")} value={accepted?.acceptedAt ? fmtDate(accepted.acceptedAt, locale) : "—"} hint={accepted ? t("office.agreement_v", { v: accepted.version }) : undefined} tone="cyan" />
        <Stat label={t("rdq.agr_valid_until")} value={accepted?.expiresAt ? fmtDate(accepted.expiresAt, locale) : accepted ? t("rdq.agr_no_expiry") : "—"} tone={accepted?.expiresAt && isPast(accepted.expiresAt) ? "danger" : "muted"} />
      </StatGrid>
      <Section title={t("nav.agreement")} description={t("rdq.agreements_sub")} actions={send || undefined}>
        {items.length === 0 ? <EmptyState title={t("office.no_agreement")} hint={t("office.no_agreement_hint")} action={send || undefined} /> : (
          <ul className="divide-y divide-line/70" data-testid="rdq-agreement-list">
            {items.map((g) => (
              <li key={g.id} className="py-3 first:pt-0 last:pb-0" data-testid={`rdq-agreement-${g.version}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">{t("office.agreement_v", { v: g.version })}</span>
                  <AgreementBadge status={g.status} expiresAt={g.expiresAt} />
                  {g.acceptedAt && <span className="text-xs text-muted">{t("office.accepted_on", { d: fmtDate(g.acceptedAt, locale) })}</span>}
                  {g.expiresAt && <Badge tone={isPast(g.expiresAt) ? "danger" : "neutral"}>{t("docs.expires")} {fmtDate(g.expiresAt, locale)}</Badge>}
                  <span className="ms-auto text-xs text-muted">{t("rdq.sent_on", { d: fmtDate(g.createdAt, locale) })}</span>
                </div>
                {g.terms && <details className="mt-2 text-sm"><summary className="cursor-pointer text-accent">{t("rdq.agr_terms")}</summary><p className="mt-2 whitespace-pre-wrap rounded-xl bg-bg2 p-3 text-muted">{g.terms}</p></details>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <SendAgreementModal officeId={id} open={open} onClose={() => setOpen(false)} onSent={done} />
    </div>
  );
}
