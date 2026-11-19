import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { InvoicesView } from "@/components/features/admin-finance-invoices";

export default function InvoicesPage() { return <Suspense fallback={<PageLoading />}><InvoicesView /></Suspense>; }
