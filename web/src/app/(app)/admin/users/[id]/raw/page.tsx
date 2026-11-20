import { UserTabGate } from "@/components/features/admin-user-detail-shell";
import { UserRaw } from "@/components/features/admin-user-detail-parts";

export default function UserRawPage() { return <UserTabGate tab="raw"><UserRaw /></UserTabGate>; }
