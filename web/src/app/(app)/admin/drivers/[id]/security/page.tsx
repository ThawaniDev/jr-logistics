import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverSecurityTab } from "@/components/features/admin-drivers-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverSecurityTab id={id} /></Suspense>;
}
