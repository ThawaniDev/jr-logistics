import { redirect } from "next/navigation";
import { withQuery, type SearchParams } from "@/components/features/admin-finance-redirect";

/** Old URL: pricing is a page of the Finance group now. */
export default async function AdminPricingRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  redirect(withQuery("/admin/finance/pricing", await searchParams));
}
