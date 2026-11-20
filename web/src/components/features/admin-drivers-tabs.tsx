"use client";
import { OwnerDocuments } from "./admin-offices-documents";
import { DocumentHistory } from "./admin-driver-docs";
import { SecurityPanel } from "./admin-driver-security";
import { PeopleActivity, PeopleNotes, PeopleRaw } from "./admin-driver-activity";

/** The small route sections of a driver (`/admin/drivers/:id/…`): documents (current status + every submission), security, activity, notes and the raw record. */
export function DriverDocumentsTab({ id }: { id: string }) { return <div className="space-y-5"><OwnerDocuments ownerId={id} kind="driver" /><DocumentHistory ownerId={id} kind="driver" /></div>; }
export function DriverSecurityTab({ id }: { id: string }) { return <SecurityPanel id={id} kind="driver" />; }
export function DriverActivityTab({ id }: { id: string }) { return <PeopleActivity id={id} />; }
export function DriverNotesTab({ id }: { id: string }) { return <PeopleNotes id={id} />; }
export function DriverRawTab({ id }: { id: string }) { return <PeopleRaw id={id} kind="driver" />; }
