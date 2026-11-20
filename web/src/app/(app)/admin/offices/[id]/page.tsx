import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeOverview } from "@/components/features/admin-offices-overview";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeOverview id={id} /></Suspense>;
}
