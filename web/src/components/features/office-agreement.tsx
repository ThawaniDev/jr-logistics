"use client";
import { useMemo } from "react";
import { CalendarCheck2, CalendarClock, FileSignature, Handshake, Hash, ShieldCheck } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Section, Stat, StatGrid, Table, Td, type Tone, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { NotReadyNotice } from "./office-shared";
import { agreementSummary, type OfficeAgreement } from "./office-lib";

export const AGREEMENT_TONE: Record<string, Tone> = { none: "neutral", pending: "warn", active: "success", expiring: "warn", expired: "danger" };
const ROW_TONE: Record<string, Tone> = { accepted: "success", pending_acceptance: "warn", superseded: "neutral" };

function Terms({ text }: { text: string | null }) {
  const { t } = useI18n();
  return text ? <p className="whitespace-pre-wrap rounded-xl bg-bg2 p-4 text-sm leading-relaxed text-muted">{text}</p> : <p className="text-sm text-muted">{t("rdo.agr_no_terms")}</p>;
}

export function OfficeAgreementView() {
  const { t, locale } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi<{ items: OfficeAgreement[] }>("/office/agreements");
  const dash = useApi("/office/dashboard");
  const sum = useMemo(() => (data ? agreementSummary(data.items, new Date()) : null), [data]);
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !sum) return <PageLoading />;
  const { state, active, pending, daysLeft, history } = sum;
  const current = active ?? pending ?? history[0];
  const accept = (id: string) => a.run(id, () => post(`/office/agreements/${id}/accept`), { success: "office.agreement_accepted", onDone: () => { void mutate(); void dash.mutate(); } });
  const verification = dash.data?.readiness.verification as string | undefined;

  return (
    <>
      <PageHeader title={t("nav.agreement")} subtitle={t("office.agreement_sub")} badges={history.length > 0 ? <Badge tone={AGREEMENT_TONE[state]} className="self-center">{t(`rdo.agr_${state}`)}</Badge> : undefined} />
      {verification && verification !== "verified" && <div className="mb-5"><NotReadyNotice verification={verification} /></div>}
      {history.length === 0 ? <EmptyState icon={<Handshake className="size-9" aria-hidden />} title={t("office.no_agreement")} hint={t("office.no_agreement_hint")} /> : (
        <div className="space-y-5">
          {state === "expired" && <Notice tone="danger" title={t("rdo.agr_expired")}>{t("rdo.agr_expired_note", { d: fmtDate(history.find((x) => x.status === "accepted")?.expiresAt, locale) })}</Notice>}
          {state === "expiring" && <Notice tone="warn" title={t("rdo.agr_expiring")}>{t("rdo.agr_expiring_note", { n: daysLeft ?? 0 })}</Notice>}

          <StatGrid cols={4}>
            <Stat label={t("common.status")} value={t(`rdo.agr_${state}`)} icon={<ShieldCheck className="size-5" />} tone={state === "active" ? "accent" : state === "expired" ? "danger" : state === "none" ? "muted" : "gold"} hint={t(`rdo.agr_${state}_hint`)} />
            <Stat label={t("rdo.agr_version")} value={<span className="ltr-num">v{current.version}</span>} icon={<Hash className="size-5" />} tone="cyan" hint={t("rdo.agr_version_hint")} />
            <Stat label={t("rdo.agr_accepted_on")} value={active?.acceptedAt ? fmtDate(active.acceptedAt, locale) : "—"} icon={<CalendarCheck2 className="size-5" />} hint={active ? t("rdo.agr_since_hint") : t("rdo.agr_not_accepted")} />
            <Stat label={t("docs.expires")} value={active?.expiresAt ? fmtDate(active.expiresAt, locale) : active ? t("rdo.agr_no_expiry") : "—"} icon={<CalendarClock className="size-5" />} tone={state === "expiring" || state === "expired" ? "gold" : "muted"} hint={daysLeft != null && active ? t("rdo.agr_days_left", { n: fmtNum(daysLeft, locale) }) : undefined} />
          </StatGrid>

          {pending && (
            <Section title={t("rdo.agr_pending_title", { v: pending.version })} description={t("rdo.agr_pending_sub")} actions={<Badge tone="warn">{t("agreement.pending_acceptance")}</Badge>}>
              <div className="space-y-4">
                <Terms text={pending.terms} />
                {pending.expiresAt && <p className="text-xs text-muted">{t("docs.expires")}: {fmtDate(pending.expiresAt, locale)}</p>}
                <Button loading={a.is(pending.id)} onClick={() => accept(pending.id)} data-testid="office-agreement-accept"><FileSignature className="size-4" aria-hidden />{t("office.accept_agreement")}</Button>
              </div>
            </Section>
          )}
          {active && (
            <Section title={t("office.agreement_v", { v: active.version })} description={active.acceptedAt ? t("office.accepted_on", { d: fmtDate(active.acceptedAt, locale) }) : undefined} actions={<Badge tone="success">{t("agreement.accepted")}</Badge>}>
              <Terms text={active.terms} />
            </Section>
          )}
          {history.length > 1 && (
            <Section title={t("rdo.agr_history")} flush>
              <Table bare stack dense label={t("rdo.agr_history")} head={[t("rdo.agr_version"), t("common.status"), t("rdo.agr_sent_on"), t("rdo.agr_accepted_on"), t("docs.expires")]}>
                {history.map((x) => (
                  <tr key={x.id} data-testid="office-agreement-row">
                    <Td label={t("rdo.agr_version")} className="ltr-num font-medium">v{x.version}</Td>
                    <Td label={t("common.status")}><Badge tone={ROW_TONE[x.status] ?? "neutral"}>{t(`agreement.${x.status}`)}</Badge></Td>
                    <Td label={t("rdo.agr_sent_on")} className="text-muted">{fmtDate(x.createdAt, locale)}</Td>
                    <Td label={t("rdo.agr_accepted_on")} className="text-muted">{fmtDate(x.acceptedAt, locale)}</Td>
                    <Td label={t("docs.expires")} className="text-muted">{x.expiresAt ? fmtDate(x.expiresAt, locale) : "—"}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
