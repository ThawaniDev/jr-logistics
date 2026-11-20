import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { PartnerOrdersList } from "@/components/features/partner-orders-list";

/** Incoming orders of every company (`?businessId=`, `?connectionId=`, `?state=`, `?city=`). View: integrations.view or requests.view; changes: integrations.manage. */
export default function AdminIncomingOrdersPage() { return <Suspense fallback={<PageLoading />}><PartnerOrdersList apiBase="/admin/integrations" /></Suspense>; }
