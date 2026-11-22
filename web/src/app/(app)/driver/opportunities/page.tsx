"use client";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Hash, Users } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Modal, Notice, PageHeader, PageLoading, Segmented } from "@/components/ui";
import { useDriverAction } from "@/components/features/driver-action";
import { useApi, useUrlState } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { OffersHiddenBanner } from "@/components/features/driver-offers";
import { offersHidden } from "@/components/features/driver-fieldops-utils";
import { post } from "@/lib/api";
import { fmtMoney, fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

function Opportunities() {
  const { t, locale } = useI18n(); const a = useDriverAction(); const router = useRouter();
  const [tabRaw, setTab] = useUrlState("view", "offers"); const tab = tabRaw === "open" ? "open" : "offers"; const [terms, setTerms] = useState(false); const [sel, setSel] = useState<null | { kind: "offer" | "apply"; id: string }>(null);
  const live = { refreshInterval: 30_000, revalidateOnFocus: true }; // offers get taken / withdrawn while the page is open
  const offers = useApi("/driver/offers", live); const opp = useApi("/driver/opportunities", live); const { data: cat } = useApi("/catalog");
  const cur = tab === "offers" ? offers : opp;
  const hidden = offersHidden(cur.data); const hiddenAny = offersHidden(offers.data).hidden || offersHidden(opp.data).hidden; // E11: busy with a job = no offers at all
  if (cur.error && !cur.data) return <ErrorState error={cur.error} retry={() => cur.mutate()} />;
  const go = () => a.run("go", () => sel!.kind === "offer" ? post(`/offers/${sel!.id}/accept`, { termsAccepted: terms }) : post(`/driver/requests/${sel!.id}/apply`, { termsAccepted: terms }), {
    success: "driver.accepted_ok", onDone: (r) => { setSel(null); setTerms(false); router.push(`/driver/jobs/${r.id}`); },
    onError: () => { cur.mutate(); },
  });
  return (
    <>
      <PageHeader title={t("nav.opportunities")} subtitle={t("opp.sub")} />
      <div className="mb-5"><Segmented label={t("nav.opportunities")} value={tab} onChange={setTab} options={[{ key: "offers", label: t("opp.directed"), count: hiddenAny ? undefined : offers.data?.items?.length }, { key: "open", label: t("opp.open"), count: hiddenAny ? undefined : opp.data?.items?.length }]} /></div>
      {!cur.data ? <PageLoading /> : (hidden.hidden || hiddenAny) ? <OffersHiddenBanner activeJob={hidden.activeJob ?? offersHidden(offers.data).activeJob ?? offersHidden(opp.data).activeJob} /> : cur.data.items.length === 0 ? <EmptyState icon={<Briefcase className="size-9" />} title={t("driver.no_offers")} hint={tab === "offers" ? t("driver.no_offers_hint") : t("ux.d_opp_empty_hint")} action={tab === "open" ? <Link href="/driver/profile" className="inline-flex min-h-11 items-center font-semibold text-cyan underline">{t("ux.d_check_profile")}</Link> : undefined} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cur.error && <div className="mb-4 sm:col-span-2 lg:col-span-2"><Notice tone="warn">{t("ux.d_stale")}</Notice></div>}
          {tab === "offers" ? cur.data.items.map((j: any) => (
            <JobCard key={j.offerId} job={j}>
              <div className="flex gap-2"><Button full size="lg" onClick={() => setSel({ kind: "offer", id: j.offerId })}>{t("act.accept")}</Button><Button variant="secondary" size="lg" full loading={a.is("rj" + j.offerId)} onClick={() => a.run("rj" + j.offerId, () => post(`/offers/${j.offerId}/reject`), { success: "driver.declined_ok", onDone: () => offers.mutate() })}>{t("act.decline")}</Button></div>
            </JobCard>
          )) : cur.data.items.map((o: any) => (
            <Card key={o.requestId} className="space-y-3 p-4">
              <div className="flex justify-between"><p className="font-semibold">{t(`svc.${o.service}`)} <span className="ltr-num text-xs font-normal text-muted">· {o.ref}</span></p><Badge tone="info">{t("opp.open_slots", { n: o.openSlots })}</Badge></div>
              <p className="text-sm text-muted">{fmtDateTime(o.startsAt, locale)} · {t(`city.${o.pickupCity}`)} → {t(`city.${o.deliveryCity}`)}</p>
              {o.service === "delivery_driver" && o.expectedUnits != null && <><p className="flex items-center gap-2 text-sm text-muted"><Hash className="size-4 shrink-0 text-cyan" aria-hidden />{t("dstop.up_to_parcels", { n: fmtNum(o.expectedUnits, locale) })}</p><p className="text-xs text-muted">{t("dstop.share_note")}</p></>}
              {o.allowPartial === false && <p className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-medium text-gold"><Users className="size-4 shrink-0" aria-hidden />{t("dstop.all_or_nothing")}</p>}
              {o.expectedEarningCents != null && <div className="flex justify-between rounded-xl bg-accent/10 px-3 py-2"><span className="text-xs text-muted">{t("job.expected_earning")}</span><span className="ltr-num font-bold text-accent">{fmtMoney(o.expectedEarningCents, locale)}</span></div>}
              <Button full size="lg" onClick={() => setSel({ kind: "apply", id: o.requestId })}>{t("act.apply")}</Button>
            </Card>
          ))}
        </div>
      )}
      <Modal busy={a.is("go")} open={!!sel} onClose={() => setSel(null)} title={t("opp.terms_title")} footer={<><Button variant="ghost" onClick={() => setSel(null)}>{t("common.cancel")}</Button><Button disabled={!terms} loading={a.is("go")} onClick={go}>{t("act.accept_job")}</Button></>}>
        <div className="max-h-40 overflow-y-auto rounded-xl bg-bg2 p-3 text-xs leading-relaxed text-muted">{cat?.terms?.driver || t("opp.terms_default")}</div>
        <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("opp.terms_accept")} />
      </Modal>
    </>
  );
}
export default function OpportunitiesPage() { return <Suspense fallback={<PageLoading />}><Opportunities /></Suspense>; }
