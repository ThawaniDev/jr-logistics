"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, EmptyState, Pagination, Skeleton } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { agreementView, needsPager } from "./admin-offices-lib";

/** Small pieces shared by the admin offices, drivers and users views (all three are lists that open an entity view). */

/** Trailing "open" chevron of a table row (the name is a link too; this is the obvious target on touch screens). */
export function RowLink({ href, label, testid }: { href: string; label: string; testid?: string }) {
  return <Link href={href} aria-label={label} title={label} data-testid={testid} className="jr-tap inline-flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-bg2 hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link>;
}

/** Placeholder rows while the first page loads (the toolbar stays usable). */
export function LoadingRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return <>{Array.from({ length: rows }, (_, i) => <tr key={i} aria-hidden><td colSpan={cols} className="px-4 py-3"><Skeleton className="h-8 w-full" /></td></tr>)}</>;
}

/** Table footer: the pager, or nothing when everything fits on one page (no empty bordered strip). */
export function pagerFooter(page: number, total: number, size: number, onPage: (p: number) => void) {
  return needsPager(total, size) ? <div className="[&>nav]:mt-0"><Pagination page={page} total={total} pageSize={size} onPage={onPage} /></div> : undefined;
}

/** Empty state inside a table card: with filters on it offers to clear them, otherwise it explains how rows appear. */
export function ListEmpty({ filtered, onClear, title, hint, action }: { filtered: boolean; onClear: () => void; title: string; hint: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="p-4"><EmptyState title={filtered ? t("common.no_results") : title} hint={filtered ? t("rdq.empty_filtered") : hint}
      action={filtered ? <button type="button" onClick={onClear} className="text-sm font-medium text-accent hover:underline">{t("uxa.clear_filters")}</button> : action} /></div>
  );
}

export function Money({ cents }: { cents: number | null | undefined }) {
  const { locale } = useI18n();
  // dir="auto": the amount follows the direction of its own first character, so the Arabic "ر.س." symbol is not reversed by a forced LTR box.
  return <span dir="auto" className="inline-block tabular-nums">{fmtMoney(cents, locale)}</span>;
}

/** Badge for the latest agreement of an office (none / awaiting acceptance / accepted / expired). */
export function AgreementBadge({ status, expiresAt }: { status: string | null | undefined; expiresAt?: string | Date | null }) {
  const { t } = useI18n(); const v = agreementView(status, expiresAt);
  return <Badge tone={v.tone}>{t(v.label)}</Badge>;
}
