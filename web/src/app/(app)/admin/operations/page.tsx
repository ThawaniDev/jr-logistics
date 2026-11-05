"use client";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageLoading, Stat, useAction, Button } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { post } from "@/lib/api";

export default function Operations() {
  const { t, locale } = useI18n(); const a = useAction();
  const today = useApi("/admin/ops/today", { refreshInterval: 30000 }); const alerts = useApi("/admin/ops/alerts", { refreshInterval: 30000 });
  if (alerts.error) return <ErrorState error={alerts.error} retry={() => alerts.mutate()} />;
  if (!today.data || !alerts.data) return <PageLoading />;
  const d = today.data;
  const tone = { critical: "danger", warning: "warn", info: "info" } as const;
  return (
    <>
      <PageHeader title={t("nav.operations")} subtitle={t("ops.sub")} />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("ops.scheduled")} value={d.scheduled} tone="muted" /><Stat label={t("ops.arrived")} value={d.arrived + d.working} tone="cyan" /><Stat label={t("ops.awaiting")} value={d.awaitingConfirmation} tone="gold" /><Stat label={t("ops.done")} value={d.done} />
        <Stat label={t("ops.accepted_waiting")} value={d.accepted} tone="muted" /><Stat label={t("ops.disputed")} value={d.disputed} tone={d.disputed ? "danger" : "muted"} /><Stat label={t("ops.no_show")} value={d.noShow} tone={d.noShow ? "danger" : "muted"} />
      </div>
      <h2 className="mb-3 font-semibold">{t("ops.alerts")}</h2>
      {alerts.data.items.length === 0 ? <EmptyState icon={<CheckCircle2 className="size-9 text-accent" />} title={t("ops.all_clear")} /> : (
        <div className="space-y-2">{alerts.data.items.map((al: any, i: number) => (
          <Card key={i} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3"><Badge tone={tone[al.severity as keyof typeof tone]}>{t(`ops.sev_${al.severity}`)}</Badge><div><p className="font-medium">{t(`alert.${al.type}`)}</p><p className="text-xs text-muted">{al.ref && <span className="ltr-num">{al.ref} · </span>}{al.detail?.driver ?? al.detail?.owner ?? ""} {al.detail?.startsAt ? fmtDateTime(al.detail.startsAt, locale) : ""}{al.detail?.open ? ` · ${t("ops.open_slots", { n: al.detail.open })}` : ""}</p></div></div>
            <div className="flex gap-2">{al.requestId && <Link href={`/admin/requests/${al.requestId}`}><Button size="sm" variant="secondary">{t("common.open")}</Button></Link>}{al.type === "unfilled_soon" && <Button size="sm" loading={a.is(al.requestId)} onClick={() => a.run(al.requestId, () => post(`/admin/requests/${al.requestId}/rematch`), { success: "ops.rematched", onDone: () => alerts.mutate() })}>{t("ops.rematch")}</Button>}</div>
          </Card>))}</div>
      )}
    </>
  );
}
