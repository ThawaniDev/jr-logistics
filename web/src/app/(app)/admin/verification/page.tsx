import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/ui";
import { verificationTabTarget } from "@/components/features/admin-companies-lib";
import { VerificationAccounts } from "@/components/features/admin-verification-accounts";

/** `/admin/verification` is the accounts queue; the old `?tab=docs|business|offices|drivers|accounts` links forward to their new routes. */
export default async function AdminVerification({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tab = (await searchParams).tab;
  const target = verificationTabTarget(Array.isArray(tab) ? tab[0] : tab);
  if (target) redirect(target);
  return <Suspense fallback={<PageLoading />}><VerificationAccounts /></Suspense>;
}
