"use client";
import { FileCheck2, MapPin, ShieldCheck, Star } from "lucide-react";
import { Stat, StatGrid, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { docProgress, dayNumber } from "./business-views-lib";
import { fmtNum, isoToRiyadhLocal } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

/** The company profile's KPI row: verification, warehouse pin, documents and rating — each linking to where it is fixed. */
export function ProfileKpis() {
  const { t, locale } = useI18n();
  const prof = useApi("/profile"); const ov = useApi("/business/overview"); const docs = useApi("/documents"); const cat = useApi("/catalog");
  const vs: string | undefined = prof.data?.profile?.verificationStatus;
  const whSet: boolean | undefined = ov.data ? ov.data.warehouse != null : undefined;
  const types: Array<{ key: string; required: boolean }> | undefined = cat.data?.documents?.business;
  const d = docs.data && types ? docProgress(types, docs.data.items ?? [], dayNumber(isoToRiyadhLocal(new Date().toISOString()).slice(0, 10))) : null;
  const rating: number | null | undefined = ov.data ? ov.data.rating ?? null : undefined;
  return (
    <StatGrid cols={4}>
      <Stat label={t("verify.title")} value={vs ? <StatusBadge status={vs} /> : "—"} hint={vs === "verified" ? t("docs.verified_note") : t("rdz.pf_verify_hint")} icon={<ShieldCheck className="size-5" />} tone={vs === "verified" ? "accent" : vs === "rejected" || vs === "suspended" ? "danger" : "gold"} href="/business/documents" loading={prof.isLoading} />
      <Stat label={t("fob.wh_title")} value={whSet === undefined ? "—" : t(whSet ? "fob.wh_state_set" : "fob.wh_state_missing")} hint={whSet === false ? t("fob.wh_missing_body_short") : t("rdz.pf_wh_hint")} icon={<MapPin className="size-5" />} tone={whSet === false ? "gold" : "cyan"} href="#warehouse" loading={ov.isLoading} />
      <Stat label={t("nav.documents")} value={d ? <span className="ltr-num">{d.approved}/{d.total}</span> : "—"} hint={d ? (d.expired + d.rejected > 0 ? t("rdz.pf_docs_attention", { n: fmtNum(d.expired + d.rejected, locale) }) : d.missing > 0 ? t("ubz.docs_missing", { n: d.missing }) : d.review > 0 ? t("ubz.docs_in_review") : t("ubz.docs_all_done")) : undefined} icon={<FileCheck2 className="size-5" />} tone={d && d.expired + d.rejected > 0 ? "danger" : "muted"} href="/business/documents" loading={docs.isLoading || cat.isLoading} />
      <Stat label={t("rdz.rating")} value={rating == null ? "—" : <span className="ltr-num">★ {rating}</span>} hint={rating == null ? t("rdz.pf_no_rating") : t("rdz.pf_rating_hint")} icon={<Star className="size-5" />} tone="gold" loading={ov.isLoading} />
    </StatGrid>
  );
}
