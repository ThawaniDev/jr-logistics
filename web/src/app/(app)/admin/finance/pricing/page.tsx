import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { PricingView } from "@/components/features/admin-finance-pricing";

export default function PricingPage() { return <Suspense fallback={<PageLoading />}><PricingView /></Suspense>; }
