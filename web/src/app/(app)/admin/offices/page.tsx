import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OfficesList } from "@/components/features/admin-offices-list";

export default function AdminOffices() {
  return <Suspense fallback={<PageLoading />}><OfficesList /></Suspense>;
}
