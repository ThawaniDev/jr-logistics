import type { businessOverviewReport } from "@/server/analytics/portal-company";
import type { businessDeliveriesReport, businessSpendingReport } from "@/server/analytics/portal-company-reports";
import type { officeOverviewReport } from "@/server/analytics/portal-office";
import type { officeDriversReport, officeEarningsReport } from "@/server/analytics/portal-office-reports";
import type { ReportMeta } from "../types";

/** The `meta` of a portal response: the shared meta plus which ownership filters were ignored and which sections failed (they arrive as `null`). */
export type PortalMeta = ReportMeta & { ignored?: string[]; failed?: string[] };
type Wrap<T> = Omit<T, "meta"> & { meta: PortalMeta };
export type BusinessOverviewData = Wrap<Awaited<ReturnType<typeof businessOverviewReport>>>;
export type BusinessDeliveriesData = Wrap<Awaited<ReturnType<typeof businessDeliveriesReport>>>;
export type BusinessSpendingData = Wrap<Awaited<ReturnType<typeof businessSpendingReport>>>;
export type OfficeOverviewData = Wrap<Awaited<ReturnType<typeof officeOverviewReport>>>;
export type OfficeDriversData = Wrap<Awaited<ReturnType<typeof officeDriversReport>>>;
export type OfficeEarningsData = Wrap<Awaited<ReturnType<typeof officeEarningsReport>>>;
export type PortalRole = "business" | "office";
