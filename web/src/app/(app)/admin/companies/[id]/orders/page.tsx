import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyOrders } from "@/components/features/admin-companies-orders";

export default function CompanyOrdersPage() { return <CompanyTabGate tab="orders"><Suspense fallback={<PageLoading />}><CompanyOrders /></Suspense></CompanyTabGate>; }
