/**
 * Warehouse and office columns of the cash pages (J6) — the pure shaping, shared by `/business/cod`, its remittance history and Finance › Drivers.
 *
 * - **warehouse** = the order's pickup point: the first line of `requests.pickup_address`, else the company's name; plus the pickup city key (`requests.pickup_city`, translated by the UI).
 * - **office** = the courier office the driver belonged to AT THE TIME OF THE JOB (`offers.office_id`, the affiliation snapshot taken when the offer was made); `null` = an independent driver.
 */
export interface Warehouse { label: string; city: string | null }
export interface OfficeRef { officeId: string | null; officeName: string | null }

const MAX_LABEL = 80;
/** First non-empty line of a (possibly multi-line) address, clipped to a readable length. */
export function firstLine(address: string | null | undefined): string {
  const line = (address ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line.length > MAX_LABEL ? line.slice(0, MAX_LABEL - 1).trimEnd() + "…" : line;
}
export function warehouseOf(o: { pickupAddress?: string | null; companyName?: string | null; pickupCity?: string | null }): Warehouse {
  const label = firstLine(o.pickupAddress) || (o.companyName ?? "").trim();
  return { label, city: o.pickupCity?.trim() || null };
}
/** `officeName` is only meaningful with an id: a row without an office is an independent driver whatever the join returned. */
export function officeRef(officeId: string | null | undefined, officeName: string | null | undefined): OfficeRef {
  return officeId ? { officeId, officeName: officeName?.trim() || null } : { officeId: null, officeName: null };
}
