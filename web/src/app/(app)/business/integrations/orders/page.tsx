import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { PartnerOrdersList } from "@/components/features/partner-orders-list";

/** Incoming orders: what the company's warehouse systems sent to JR (`?state=`, `?connectionId=`, `?city=`). */
export default function IncomingOrdersPage() { return <Suspense fallback={<PageLoading />}><PartnerOrdersList apiBase="/integrations" /></Suspense>; }
