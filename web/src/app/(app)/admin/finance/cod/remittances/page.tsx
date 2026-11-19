import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CodConsole } from "@/components/features/admin-finance-cod";

export default function CodRemittancesPage() { return <Suspense fallback={<PageLoading />}><CodConsole tab="remittances" /></Suspense>; }
