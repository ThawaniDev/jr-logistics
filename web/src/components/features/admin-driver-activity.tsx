"use client";
import type { ReactNode } from "react";
import { ErrorState, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ActivityLog } from "./activity-log";
import { NotesPanel } from "./notes-panel";
import { RawDataPanel } from "./activity-raw";

/** Activity (the shared log of everything that happened to the account), internal notes and the raw record: the same three pages for drivers and courier offices. */
export function PeopleActivity({ id, extra }: { id: string; extra?: ReactNode }) {
  return <div className="space-y-5" data-testid="dv2-activity"><ActivityLog entity="user" id={id} />{extra}</div>;
}
export function PeopleNotes({ id }: { id: string }) { return <div data-testid="dv2-notes"><NotesPanel entity="user" id={id} /></div>; }

/** The stored record (ids, timestamps, flags, counters) for support; secrets are never in it and personal fields only for `drivers.sensitive`. */
export function PeopleRaw({ id, kind }: { id: string; kind: "driver" | "office" }) {
  const { t } = useI18n();
  const { data, error, mutate } = useApi(`/admin/${kind}s/${id}/raw`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return <div data-testid="dv2-raw"><RawDataPanel data={data} title={t(kind === "driver" ? "dv2.raw_driver" : "dv2.raw_office")} defaultOpen testId="dv2-raw-panel" /></div>;
}
