"use client";
import { DriverScorecard } from "./admin-office-detail-drivers";
import { DriverHistory } from "./admin-office-detail-history";

/** Drivers tab of an office: the scorecard (with the unlink action) and the history of links, unlinks and invitations. */
export function OfficeDriversTab({ id }: { id: string }) {
  return <div className="space-y-6"><DriverScorecard id={id} /><DriverHistory id={id} /></div>;
}
