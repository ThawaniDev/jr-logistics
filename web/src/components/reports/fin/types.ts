import type { CodData } from "@/server/analytics/cod";
import type { DeliveriesData } from "@/server/analytics/deliveries";
import type { FinanceData } from "@/server/analytics/finance";

export type { CodData, DeliveriesData, FinanceData };
export type T = (key: string, vars?: Record<string, string | number>) => string;
export type CityName = (key: string) => string | undefined;
export type { GroupRow } from "@/server/analytics/deliveries-groups";
export type { MarginRow, CompanyRow } from "@/server/analytics/finance-series";
export type { Holder, Alert } from "@/server/analytics/cod-live";
