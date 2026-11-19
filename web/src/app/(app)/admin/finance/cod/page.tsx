import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CodConsole } from "@/components/features/admin-finance-cod";

export default function CodPage() { return <Suspense fallback={<PageLoading />}><CodConsole tab="orders" /></Suspense>; }
