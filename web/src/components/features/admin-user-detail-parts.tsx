"use client";
import { ErrorState, Skeleton } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { SecurityView } from "./admin-user-detail-security";
import { useUserDetail } from "./admin-user-detail-shell";

/** Security section: sign-ins, sessions and lock state of the account. */
export function UserSecurity() { const u = useUserDetail(); return <SecurityView path={`/admin/users/${u.id}/security`} testId="dv3-user-security" />; }
/** Activity section: the shared activity log of the person (as actor and as subject). */
export function UserActivity() { const u = useUserDetail(); return <ActivityLog entity="user" id={u.id} />; }
/** Notes section: internal staff notes about the person. */
export function UserNotes() { const u = useUserDetail(); return <NotesPanel entity="user" id={u.id} />; }
/** Raw data section: the account record as stored, without secrets. */
export function UserRaw() {
  const u = useUserDetail();
  const { data, error, mutate } = useApi(`/admin/users/${u.id}/raw`, { shouldRetryOnError: false });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Skeleton className="h-24" />;
  return <RawDataPanel data={data} defaultOpen testId="dv3-user-raw" />;
}
