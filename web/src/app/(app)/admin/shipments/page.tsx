import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { ParcelSearch } from "@/components/features/admin-parcel-search";

/** The activity log links a parcel reference to `/admin/shipments?q=<code>`: it opens the same parcel search as `/admin/parcels`. */
export default function AdminShipmentSearchPage() { return <Suspense fallback={<PageLoading />}><ParcelSearch /></Suspense>; }
