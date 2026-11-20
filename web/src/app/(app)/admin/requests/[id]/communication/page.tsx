import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrderComms } from "@/components/features/admin-order-comms";

export default function AdminOrderCommunication() { return <Suspense fallback={<PageLoading />}><OrderComms /></Suspense>; }
