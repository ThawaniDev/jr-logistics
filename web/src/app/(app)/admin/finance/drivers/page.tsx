import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { FinanceDriversView } from "@/components/features/admin-finance-drivers";

export default function FinanceDriversPage() { return <Suspense fallback={<PageLoading />}><FinanceDriversView /></Suspense>; }
