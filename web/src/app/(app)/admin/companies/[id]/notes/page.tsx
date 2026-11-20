import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyNotes } from "@/components/features/admin-company-detail-activity";

export default function CompanyNotesPage() { return <CompanyTabGate tab="notes"><CompanyNotes /></CompanyTabGate>; }
