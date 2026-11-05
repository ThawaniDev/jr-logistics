"use client";
import { Handshake } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoading, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function Agreement() {
  const { t, locale } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi("/office/agreements");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.agreement")} subtitle={t("office.agreement_sub")} />
      {data.items.length === 0 ? <EmptyState icon={<Handshake className="size-9" />} title={t("office.no_agreement")} hint={t("office.no_agreement_hint")} /> : (
        <div className="space-y-4">{data.items.map((x: any) => (
          <Card key={x.id} className="space-y-3">
            <div className="flex items-center justify-between"><p className="font-semibold">{t("office.agreement_v", { v: x.version })}</p><Badge tone={x.status === "accepted" ? "success" : x.status === "pending_acceptance" ? "warn" : "neutral"}>{t(`agreement.${x.status}`)}</Badge></div>
            {x.terms && <p className="whitespace-pre-wrap rounded-xl bg-bg2 p-3 text-sm text-muted">{x.terms}</p>}
            <p className="text-xs text-muted">{x.acceptedAt ? t("office.accepted_on", { d: fmtDate(x.acceptedAt, locale) }) : ""}{x.expiresAt ? ` · ${t("docs.expires")}: ${fmtDate(x.expiresAt, locale)}` : ""}</p>
            {x.status === "pending_acceptance" && <Button loading={a.is(x.id)} onClick={() => a.run(x.id, () => post(`/office/agreements/${x.id}/accept`), { success: "office.agreement_accepted", onDone: () => mutate() })}>{t("office.accept_agreement")}</Button>}
          </Card>))}</div>
      )}
    </>
  );
}
