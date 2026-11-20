import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverLocationTab } from "@/components/features/admin-driver-location";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverLocationTab id={id} /></Suspense>;
}
