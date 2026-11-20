import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverReportsTab } from "@/components/features/admin-drivers-reports";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverReportsTab id={id} /></Suspense>;
}
