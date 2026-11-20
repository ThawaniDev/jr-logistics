import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderParcels } from "@/components/features/admin-order-parcels";

export default function AdminOrderParcels() { return <Suspense fallback={<PageLoading />}><OrderParcels /></Suspense>; }
