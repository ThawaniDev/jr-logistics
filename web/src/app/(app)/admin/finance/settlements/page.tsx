import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { SettlementsView } from "@/components/features/admin-finance-settlements";

export default function SettlementsPage() { return <Suspense fallback={<PageLoading />}><SettlementsView /></Suspense>; }
