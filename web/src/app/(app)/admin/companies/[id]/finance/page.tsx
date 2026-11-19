import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyFinance } from "@/components/features/admin-companies-finance";

export default function CompanyFinancePage() { return <CompanyTabGate tab="finance"><CompanyFinance /></CompanyTabGate>; }
