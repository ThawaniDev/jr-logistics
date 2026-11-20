import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderActivity } from "@/components/features/admin-order-activity";

export default function AdminOrderActivity() { return <Suspense fallback={<PageLoading />}><OrderActivity /></Suspense>; }
