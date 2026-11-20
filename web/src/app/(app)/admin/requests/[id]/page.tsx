import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderOverview } from "@/components/features/admin-order-overview";

export default function AdminOrderOverview() { return <Suspense fallback={<PageLoading />}><OrderOverview /></Suspense>; }
