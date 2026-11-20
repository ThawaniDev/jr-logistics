import { UserTabGate } from "@/components/features/admin-user-detail-shell";
import { UserNotes } from "@/components/features/admin-user-detail-parts";

export default function UserNotesPage() { return <UserTabGate tab="notes"><UserNotes /></UserTabGate>; }
