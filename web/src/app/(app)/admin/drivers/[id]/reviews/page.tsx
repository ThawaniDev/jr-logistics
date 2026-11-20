import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverReviewsTab } from "@/components/features/admin-driver-reviews";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverReviewsTab id={id} /></Suspense>;
}
