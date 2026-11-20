import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { FinanceDriverDetail } from "@/components/features/admin-finance-driver-detail";

export default async function FinanceDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><FinanceDriverDetail id={id} /></Suspense>;
}
