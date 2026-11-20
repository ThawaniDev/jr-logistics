import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeAgreementsTab } from "@/components/features/admin-offices-agreements";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeAgreementsTab id={id} /></Suspense>;
}
