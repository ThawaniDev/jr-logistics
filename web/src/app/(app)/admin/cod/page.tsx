import { redirect } from "next/navigation";
import { withQuery, type SearchParams } from "@/components/features/admin-finance-redirect";

/** Old URL: cash on delivery is a page of the Finance group now. The query (`offerId`, `businessId`, `driverId`, `q`) is kept. */
export default async function AdminCodRedirect({ searchParams }: { searchParams: Promise<SearchParams> }) {
  redirect(withQuery("/admin/finance/cod", await searchParams));
}
