import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverJobsTab } from "@/components/features/admin-driver-jobs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverJobsTab id={id} /></Suspense>;
}
