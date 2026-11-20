"use client";
import type { Connection } from "@/components/features/business-shipments-partner";
import { ActivityLog as SharedActivityLog, FailedUpdates as SharedFailedUpdates } from "@/components/features/partner-conn-activity";
import { BUSINESS_SCOPE } from "@/components/features/partner-conn-lib";

export type { OutboxData } from "@/components/features/partner-conn-detail";

/** Company-portal shortcuts to the shared activity views (the staff console passes its own scope). */
export function ActivityLog({ conn }: { conn: Connection }) { return <SharedActivityLog conn={conn} scope={BUSINESS_SCOPE} />; }
export function FailedUpdates(p: Omit<Parameters<typeof SharedFailedUpdates>[0], "scope">) { return <SharedFailedUpdates {...p} scope={BUSINESS_SCOPE} />; }
