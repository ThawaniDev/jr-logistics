import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { DriversList } from "@/components/features/admin-drivers-list";

export default function AdminDrivers() {
  return <Suspense fallback={<PageLoading />}><DriversList /></Suspense>;
}
