import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { ParcelView } from "@/components/features/admin-parcel-view";

export default async function AdminParcelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><ParcelView id={id} /></Suspense>;
}
