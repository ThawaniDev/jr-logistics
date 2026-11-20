import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderMoney } from "@/components/features/admin-order-money";

export default function AdminOrderMoney() { return <Suspense fallback={<PageLoading />}><OrderMoney /></Suspense>; }
