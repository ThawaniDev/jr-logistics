import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriverMoneyTab } from "@/components/features/admin-driver-money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<PageLoading />}><DriverMoneyTab id={id} /></Suspense>;
}
