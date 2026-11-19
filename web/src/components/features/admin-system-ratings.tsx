"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Frown, Star, Sparkles, Users } from "lucide-react";
import { CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, ProgressBar, Section, Segmented, Stat, StatGrid, Table, Td, Toolbar, Button } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { ApiError, get } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";
import { ratingSummary } from "./admin-system-lib";

const SIZE = 25;

/** Stars of one rating (filled gold, or red for 1–2), readable by screen readers as "N stars". */
function Stars({ n }: { n: number }) {
  const { t } = useI18n();
  return <span className={n <= 2 ? "text-danger" : "text-gold"} aria-label={t("adm.stars_n", { n })} role="img">{"★".repeat(n)}<span className="text-line">{"★".repeat(5 - n)}</span></span>;
}

/** Ratings given on completed jobs (`/admin/ratings`): average, low-score count and distribution on top, a "N stars or less" filter, and the ratings table. */
export function RatingsConsole() { return <Suspense fallback={<PageLoading />}><RatingsInner /></Suspense>; }

function RatingsInner() {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser();
  const [max, setMax] = useUrlState("max"); const [page, setPage] = useState(1);
  const allowed = hasAny(me, "reports.view", "users.view");
  const { data, error, mutate } = useApi(allowed ? `/admin/ratings${qs({ page, pageSize: SIZE, maxStars: max })}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  // `GET /admin/ratings?maxStars=n` reports how many ratings have n stars or fewer — five cheap counts give the whole distribution.
  const sum = useSWR(allowed ? "rdb-ratings-summary" : null, async () => {
    const at = await Promise.all([1, 2, 3, 4, 5].map((n) => get(`/admin/ratings?pageSize=1&maxStars=${n}`).then((r) => [n, Number(r.total)] as const)));
    return ratingSummary(Object.fromEntries(at));
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
  if (!allowed) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  const s = sum.data;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const options = [{ key: "", label: t("common.all"), count: s?.total }, ...[4, 3, 2, 1].map((n) => ({ key: String(n), label: t("rdb.rt_upto", { n }) }))];

  return (
    <>
      <PageHeader title={t("nav.ratings")} subtitle={t("adm.ratings_sub")} icon={<Star className="size-5" />} />
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("rdb.rt_avg")} value={s ? (s.avg === null ? "—" : <span className="ltr-num">{fmtNum(s.avg, locale)} <span className="text-gold">★</span></span>) : 0} loading={!s} tone="gold" icon={<Star className="size-5" aria-hidden />} hint={s ? t("adm.ratings_n", { n: s.total }) : undefined} />
        <Stat label={t("rdb.rt_five")} value={s ? s.dist[4] : 0} loading={!s} icon={<Sparkles className="size-5" aria-hidden />} hint={s ? t("rdb.rt_share", { p: pct(s.fiveShare) }) : undefined} />
        <Stat label={t("rdb.rt_low")} value={s ? s.low : 0} loading={!s} tone={s?.low ? "danger" : "muted"} icon={<Frown className="size-5" aria-hidden />} href="/admin/ratings?max=2" hint={s ? t("rdb.rt_share", { p: pct(s.lowShare) }) : undefined} />
        <Stat label={t("rdb.rt_total")} value={s ? s.total : 0} loading={!s} tone="muted" icon={<Users className="size-5" aria-hidden />} hint={t("rdb.rt_total_hint")} />
      </StatGrid>
      {s && s.total > 0 && (
        <Section title={t("rdb.rt_dist")} className="mb-6">
          <ul className="space-y-2" aria-label={t("rdb.rt_dist")}>
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n} className="grid grid-cols-[3.25rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="ltr-num whitespace-nowrap text-muted">{n} <span className="text-gold">★</span></span>
                <ProgressBar value={s.dist[n - 1]} max={Math.max(...s.dist, 1)} tone={n <= 2 ? "danger" : n === 3 ? "gold" : "accent"} label={t("adm.stars_n", { n })} />
                <span className="ltr-num text-end tabular-nums">{s.dist[n - 1]}</span>
              </li>))}
          </ul>
        </Section>)}

      <Toolbar><Segmented label={t("adm.max_stars")} value={max} onChange={(v) => { setMax(v); setPage(1); }} options={options} /></Toolbar>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        <EmptyState icon={<Star className="size-9" aria-hidden />} title={max ? t("common.no_results") : t("rdb.rt_none")} hint={max ? undefined : t("rdb.rt_none_hint")} action={max ? <Button variant="secondary" size="sm" onClick={() => setMax("")}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack label={t("nav.ratings")} head={[t("common.date"), t("req.ref"), t("adm.rating_stars"), t("adm.rated_by"), t("adm.rated"), t("adm.comment")]}>
          {data.items.map((r: any) => (
            <tr key={r.id} data-testid={`rdb-rating-${r.id}`} className={r.stars <= 2 ? "bg-danger/[0.04]" : undefined}>
              <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
              <Td label={t("req.ref")} className="ltr-num font-semibold">{hasAny(me, "requests.view") ? <Link href={`/admin/requests${qs({ q: r.ref, go: 1 })}`} className="text-accent hover:underline">{r.ref}</Link> : r.ref}</Td>
              <Td label={t("adm.rating_stars")} className="whitespace-nowrap"><Stars n={r.stars} /></Td>
              <Td label={t("adm.rated_by")}><CellPair title={r.rater} sub={tx(`role.${r.raterRole}`, r.raterRole)} /></Td>
              <Td label={t("adm.rated")}><CellPair title={r.ratee} sub={tx(`role.${r.rateeRole}`, r.rateeRole)} /></Td>
              <Td label={t("adm.comment")} className="max-w-72 text-muted"><span className="line-clamp-2 break-words">{r.comment ?? "—"}</span></Td>
            </tr>))}
        </Table>
        <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
        <p className="mt-2 text-xs text-muted">{t("uxa.total_n", { n: data.total })}</p>
      </>}
    </>
  );
}
