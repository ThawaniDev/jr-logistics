"use client";
import { useCompany } from "./admin-companies-ctx";
import { SecurityView } from "./admin-user-detail-security";

/** Security tab: sign-ins, live sessions and API-key use of the company's account (same view as a user's Security section). */
export function CompanySecurity() { const c = useCompany(); return <SecurityView path={`/admin/companies/${c.id}/security`} testId="dv3-company-security" />; }
