import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyParcels } from "@/components/features/admin-company-detail-parcels";

export default function CompanyParcelsPage() { return <CompanyTabGate tab="parcels"><Suspense fallback={<PageLoading />}><CompanyParcels /></Suspense></CompanyTabGate>; }
