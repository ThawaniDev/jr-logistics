import { CompanyTabGate } from "@/components/features/admin-companies-shell";
import { CompanyWarehouse } from "@/components/features/admin-companies-warehouse";

export default function CompanyWarehousePage() { return <CompanyTabGate tab="warehouse"><CompanyWarehouse /></CompanyTabGate>; }
