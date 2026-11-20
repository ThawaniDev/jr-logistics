import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverActivityTab } from "@/components/features/admin-drivers-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverActivityTab id={id} /></Suspense>;
}
