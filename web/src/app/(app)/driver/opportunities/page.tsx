"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Modal, PageHeader, PageLoading, Tabs, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { post } from "@/lib/api";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function Opportunities() {
  const { t, locale } = useI18n(); const a = useAction(); const router = useRouter();
  const [tab, setTab] = useState("offers"); const [terms, setTerms] = useState(false); const [sel, setSel] = useState<null | { kind: "offer" | "apply"; id: string }>(null);
  const offers = useApi("/driver/offers"); const opp = useApi("/driver/opportunities"); const { data: cat } = useApi("/catalog");
  const cur = tab === "offers" ? offers : opp;
  if (cur.error) return <ErrorState error={cur.error} retry={() => cur.mutate()} />;
  const go = () => a.run("go", () => sel!.kind === "offer" ? post(`/offers/${sel!.id}/accept`, { termsAccepted: terms }) : post(`/driver/requests/${sel!.id}/apply`, { termsAccepted: terms }), {
    success: "driver.accepted_ok", onDone: (r) => { setSel(null); setTerms(false); router.push(`/driver/jobs/${r.id}`); },
    onError: () => { cur.mutate(); },
  });
  return (
    <>
      <PageHeader title={t("nav.opportunities")} subtitle={t("opp.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "offers", label: t("opp.directed"), count: offers.data?.items?.length }, { key: "open", label: t("opp.open"), count: opp.data?.items?.length }]} />
      {!cur.data ? <PageLoading /> : cur.data.items.length === 0 ? <EmptyState icon={<Briefcase className="size-9" />} title={t("driver.no_offers")} hint={t("driver.no_offers_hint")} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tab === "offers" ? cur.data.items.map((j: any) => (
            <JobCard key={j.offerId} job={j}>
              <div className="flex gap-2"><Button full onClick={() => setSel({ kind: "offer", id: j.offerId })}>{t("act.accept")}</Button><Button variant="secondary" full loading={a.is("rj" + j.offerId)} onClick={() => a.run("rj" + j.offerId, () => post(`/offers/${j.offerId}/reject`), { success: "driver.declined_ok", onDone: () => offers.mutate() })}>{t("act.decline")}</Button></div>
            </JobCard>
          )) : cur.data.items.map((o: any) => (
            <Card key={o.requestId} className="space-y-3 p-4">
              <div className="flex justify-between"><p className="font-semibold">{t(`svc.${o.service}`)} <span className="ltr-num text-xs font-normal text-muted">· {o.ref}</span></p><Badge tone="info">{t("opp.open_slots", { n: o.openSlots })}</Badge></div>
              <p className="text-sm text-muted">{fmtDateTime(o.startsAt, locale)} · {t(`city.${o.pickupCity}`)} → {t(`city.${o.deliveryCity}`)}</p>
              {o.expectedEarningCents != null && <div className="flex justify-between rounded-xl bg-accent/10 px-3 py-2"><span className="text-xs text-muted">{t("job.expected_earning")}</span><span className="ltr-num font-bold text-accent">{fmtMoney(o.expectedEarningCents, locale)}</span></div>}
              <Button full onClick={() => setSel({ kind: "apply", id: o.requestId })}>{t("act.apply")}</Button>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={t("opp.terms_title")} footer={<><Button variant="ghost" onClick={() => setSel(null)}>{t("common.cancel")}</Button><Button disabled={!terms} loading={a.is("go")} onClick={go}>{t("act.accept_job")}</Button></>}>
        <div className="max-h-40 overflow-y-auto rounded-xl bg-bg2 p-3 text-xs leading-relaxed text-muted">{cat?.terms?.driver || t("opp.terms_default")}</div>
        <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("opp.terms_accept")} />
      </Modal>
    </>
  );
}
