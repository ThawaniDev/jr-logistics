import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderDrivers } from "@/components/features/admin-order-drivers";

export default function AdminOrderDrivers() { return <Suspense fallback={<PageLoading />}><OrderDrivers /></Suspense>; }
