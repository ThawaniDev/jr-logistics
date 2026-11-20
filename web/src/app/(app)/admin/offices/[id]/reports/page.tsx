import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeReportsTab } from "@/components/features/admin-offices-reports";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeReportsTab id={id} /></Suspense>;
}
