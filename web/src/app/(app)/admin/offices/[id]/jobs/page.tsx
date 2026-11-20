import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeJobsTab } from "@/components/features/admin-offices-jobs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeJobsTab id={id} /></Suspense>;
}
