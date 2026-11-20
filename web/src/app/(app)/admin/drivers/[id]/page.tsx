import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverOverview } from "@/components/features/admin-drivers-overview";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverOverview id={id} /></Suspense>;
}
