import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { WithdrawalsView } from "@/components/features/admin-finance-withdrawals";

export default function WithdrawalsPage() { return <Suspense fallback={<PageLoading />}><WithdrawalsView /></Suspense>; }
