import { UserTabGate } from "@/components/features/admin-user-detail-shell";
import { UserSecurity } from "@/components/features/admin-user-detail-parts";

export default function UserSecurityPage() { return <UserTabGate tab="security"><UserSecurity /></UserTabGate>; }
