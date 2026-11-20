import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeDriversTab } from "@/components/features/admin-offices-drivers";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeDriversTab id={id} /></Suspense>;
}
