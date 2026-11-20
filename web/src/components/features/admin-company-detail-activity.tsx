"use client";
import { ErrorState, Skeleton } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { useCompany } from "./admin-companies-ctx";

/** Activity tab: the shared activity log of the company's account — orders, parcels, money, support, documents, sign-ins, messages, integrations and every audited action. */
export function CompanyActivity() { const c = useCompany(); return <ActivityLog entity="user" id={c.id} />; }

/** Notes tab: internal staff notes on the company (never shown to the company). */
export function CompanyNotes() { const c = useCompany(); return <NotesPanel entity="user" id={c.id} />; }

/** Raw data tab: the account, profile and wallet records exactly as stored (no secrets), for support. */
export function CompanyRaw() {
  const c = useCompany();
  const { data, error, mutate } = useApi(`/admin/companies/${c.id}/raw`, { shouldRetryOnError: false });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Skeleton className="h-24" />;
  return <RawDataPanel data={data} defaultOpen testId="dv3-raw" />;
}
