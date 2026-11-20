import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CompanyOverview } from "@/components/features/admin-companies-overview";

export default function CompanyOverviewPage() { return <Suspense fallback={<PageLoading />}><CompanyOverview /></Suspense>; }
