import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeSecurityTab } from "@/components/features/admin-office-detail-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeSecurityTab id={id} /></Suspense>;
}
