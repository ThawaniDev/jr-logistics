import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverParcelsTab } from "@/components/features/admin-driver-parcels";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverParcelsTab id={id} /></Suspense>;
}
