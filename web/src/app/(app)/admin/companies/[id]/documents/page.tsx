import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyDocuments } from "@/components/features/admin-companies-documents";

export default function CompanyDocumentsPage() { return <CompanyTabGate tab="documents"><CompanyDocuments /></CompanyTabGate>; }
