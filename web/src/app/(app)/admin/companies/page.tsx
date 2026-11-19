import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CompaniesList } from "@/components/features/admin-companies-list";

export default function AdminCompanies() { return <Suspense fallback={<PageLoading />}><CompaniesList /></Suspense>; }
