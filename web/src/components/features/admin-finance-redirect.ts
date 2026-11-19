/**
 * Old finance URLs keep working (decision F11): `/admin/finance?tab=ledger&request=…`, `/admin/cod?offerId=…`, `/admin/pricing`.
 * Pure helpers used by the redirect pages; unit-tested in tests/unit/finance-redirect.test.ts.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The tabs the single Finance page used to have; each is a page of the Finance group now. */
export const FINANCE_TABS = ["settlements", "withdrawals", "ledger", "invoices"] as const;

/** `path` plus every query parameter of `sp` except those in `drop` (repeated parameters stay repeated, empty ones go). */
export function withQuery(path: string, sp: SearchParams, drop: readonly string[] = []): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (drop.includes(k) || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) if (one !== "") q.append(k, one);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Where an old `/admin/finance?…` URL belongs, or `null` when the Overview should render.
 * `?tab=settlements|withdrawals|ledger|invoices` → that page (other parameters kept); `?request=<id>` without a tab meant the ledger of that request.
 */
export function financeRedirect(sp: SearchParams): string | null {
  const tab = first(sp.tab);
  if (tab && (FINANCE_TABS as readonly string[]).includes(tab)) return withQuery(`/admin/finance/${tab}`, sp, ["tab"]);
  if (!tab && (first(sp.request) || first(sp.requestId))) return withQuery("/admin/finance/ledger", sp);
  return null;
}
