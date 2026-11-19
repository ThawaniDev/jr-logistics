import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { LedgerView } from "@/components/features/admin-finance-ledger";

export default function LedgerPage() { return <Suspense fallback={<PageLoading />}><LedgerView /></Suspense>; }
