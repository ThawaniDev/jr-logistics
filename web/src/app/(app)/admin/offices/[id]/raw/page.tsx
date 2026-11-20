import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeRawTab } from "@/components/features/admin-office-detail-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeRawTab id={id} /></Suspense>;
}
