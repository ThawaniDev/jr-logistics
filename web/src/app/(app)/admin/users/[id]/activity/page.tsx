import { UserTabGate } from "@/components/features/admin-user-detail-shell";
import { UserActivity } from "@/components/features/admin-user-detail-parts";

export default function UserActivityPage() { return <UserTabGate tab="activity"><UserActivity /></UserTabGate>; }
