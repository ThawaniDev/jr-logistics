import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { ParcelSearch } from "@/components/features/admin-parcel-search";

export default function AdminParcelSearchPage() { return <Suspense fallback={<PageLoading />}><ParcelSearch /></Suspense>; }
