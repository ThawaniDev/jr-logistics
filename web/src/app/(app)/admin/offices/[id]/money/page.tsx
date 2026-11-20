import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeMoneyTab } from "@/components/features/admin-office-detail-money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeMoneyTab id={id} /></Suspense>;
}
