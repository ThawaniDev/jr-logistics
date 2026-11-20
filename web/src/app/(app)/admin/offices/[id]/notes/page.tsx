import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficeNotesTab } from "@/components/features/admin-office-detail-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><OfficeNotesTab id={id} /></Suspense>;
}
