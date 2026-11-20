import { Suspense } from "react";
import { PageLoading } from "@/components/ui";

/**
 * Shared frame of every report page. It only wraps the page: the sidebar's Reports group is the navigation. The Suspense boundary is what lets a report page read
 * its filters from the URL (`useReportFilters` uses `useSearchParams`), so individual report pages do not need their own.
 */
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}
