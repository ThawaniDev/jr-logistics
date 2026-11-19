import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/ui";
import { FinanceOverview } from "@/components/features/admin-finance-overview";
import { financeRedirect, type SearchParams } from "@/components/features/admin-finance-redirect";

/** Finance overview. Old links to the single tabbed page (`?tab=ledger&request=…`) are sent to the page that now holds that tab. */
export default async function FinancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const to = financeRedirect(await searchParams);
  if (to) redirect(to);
  return <Suspense fallback={<PageLoading />}><FinanceOverview /></Suspense>;
}
