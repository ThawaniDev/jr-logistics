import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyIntegrations } from "@/components/features/admin-company-detail-integrations";

export default function CompanyIntegrationsPage() { return <CompanyTabGate tab="integrations"><CompanyIntegrations /></CompanyTabGate>; }
