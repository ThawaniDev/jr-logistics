"use client";
import { Suspense } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { Button, EmptyState, PageLoading } from "@/components/ui";
import { ShipmentsSection } from "@/components/features/business-shipments-table";
import { useRequest } from "@/components/features/business-views-request-ctx";
import { useI18n } from "@/i18n/provider";

export default function Page() { return <Suspense fallback={<PageLoading />}><Parcels /></Suspense>; }

function Parcels() {
  const { t } = useI18n(); const { id, base, r, manifest, incomplete, mutate, openComplete } = useRequest();
  if (!manifest) return <EmptyState icon={<Package className="size-9" aria-hidden />} title={t("rdz.no_parcels")} hint={t("rdz.no_parcels_hint")} action={<Link href={base}><Button variant="secondary">{t("rdz.back_overview")}</Button></Link>} />;
  return <ShipmentsSection requestId={id} requestStatus={r.status} onChanged={mutate} incomplete={incomplete} onCompleteDetails={openComplete} />;
}
