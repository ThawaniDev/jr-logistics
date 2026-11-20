import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanySecurity } from "@/components/features/admin-company-detail-security";

export default function CompanySecurityPage() { return <CompanyTabGate tab="security"><CompanySecurity /></CompanyTabGate>; }
