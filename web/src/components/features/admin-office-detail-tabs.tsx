"use client";
import { SecurityPanel } from "./admin-driver-security";
import { PeopleActivity, PeopleNotes, PeopleRaw } from "./admin-driver-activity";
import { DriverEvents, DriverHistory } from "./admin-office-detail-history";

/** The small route sections of a courier office: security, activity (the account's log plus the history of its drivers), notes and the raw record. */
export function OfficeSecurityTab({ id }: { id: string }) { return <SecurityPanel id={id} kind="office" />; }
export function OfficeActivityTab({ id }: { id: string }) { return <PeopleActivity id={id} extra={<><DriverEvents id={id} /><DriverHistory id={id} /></>} />; }
export function OfficeNotesTab({ id }: { id: string }) { return <PeopleNotes id={id} />; }
export function OfficeRawTab({ id }: { id: string }) { return <PeopleRaw id={id} kind="office" />; }
