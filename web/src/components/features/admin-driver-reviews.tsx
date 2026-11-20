"use client";
import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Star } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, PageLoading, Section, Segmented, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";
import { pagerFooter } from "./admin-offices-common";

const SIZE = 10;
const Stars = ({ n }: { n: number }) => <span className="ltr-num whitespace-nowrap text-gold" aria-label={`${n}/5`}>{"★".repeat(n)}<span className="text-line">{"★".repeat(5 - n)}</span></span>;

/** Reviews & support of a driver: the ratings received (with the comment and who gave it) and the tickets and complaints that involve the driver, each linked to its page. */
export function DriverReviewsTab({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [stars, setStars] = useState("all"); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/admin/drivers/${id}/reviews${qs({ stars: stars === "all" ? "" : stars, page, pageSize: SIZE })}`, { keepPreviousData: true });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const canRequest = hasAny(me, "requests.view"), canBusiness = hasAny(me, "users.view", "verification.manage", "offices.view");
  const low = data.distribution.filter((d: any) => d.stars <= 2).reduce((n: number, d: any) => n + d.count, 0);
  const support = (list: any[] | null, kind: "ticket" | "complaint") => (list === null
    ? <Notice tone="info">{t("dv2.support_hidden")}</Notice>
    : list.length === 0 ? <EmptyState icon={<MessageSquare className="size-8" aria-hidden />} title={t(kind === "ticket" ? "dv2.tickets_none" : "dv2.complaints_none")} /> : (
      <Table stack bare dense label={t(kind === "ticket" ? "dv2.tickets_title" : "dv2.complaints_title")} head={[t("dv2.col_ref"), t("dv2.col_topic"), t("common.status"), t("dv2.col_involved"), t("dv2.col_first_response"), t("common.date")]}>
        {list.map((x) => (
          <tr key={x.id} data-testid={`dv2-${kind}-${x.id}`}>
            <Td><Link href={kind === "ticket" ? `/admin/cases/${x.id}` : `/admin/complaints/${x.id}`} className="ltr-num font-semibold text-accent hover:underline">{x.ref}</Link>{x.priority === "urgent" && <Badge tone="danger" className="ms-2">{t("dv2.urgent")}</Badge>}
              {x.orderRef && <span className="block text-xs text-muted">{canRequest && x.requestId ? <Link href={`/admin/requests/${x.requestId}`} className="ltr-num hover:underline">{x.orderRef}</Link> : <span className="ltr-num">{x.orderRef}</span>}</span>}</Td>
            <Td label={t("dv2.col_topic")} className="max-w-72"><span className="font-medium">{tx(`${kind === "ticket" ? "ticket_cat" : "complaint_cat"}.${x.category}`, x.category)}</span><span className="block truncate text-xs text-muted" title={x.subject ?? x.description}>{x.subject ?? x.description}</span></Td>
            <Td label={t("common.status")}><StatusBadge status={x.status} /></Td>
            <Td label={t("dv2.col_involved")}><Badge tone={x.byDriver ? "info" : "warn"}>{x.byDriver ? t("dv2.by_driver") : t("dv2.about_driver")}</Badge></Td>
            <Td label={t("dv2.col_first_response")} className="whitespace-nowrap text-muted">{x.firstResponseAt ? fmtDateTime(x.firstResponseAt, locale) : "—"}</Td>
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(x.createdAt, locale)}</Td>
          </tr>
        ))}
      </Table>
    ));
  return (
    <div className="space-y-5" data-testid="dv2-reviews">
      <StatGrid cols={4}>
        <Stat label={t("driver.rating")} icon={<Star className="size-5" />} tone="gold" value={data.avg != null ? <span className="ltr-num">★ {data.avg.toFixed(2)}</span> : "—"} hint={t("adm.ratings_n", { n: data.count })} />
        <Stat label={t("dv2.low_ratings")} tone={low ? "danger" : "muted"} value={low} hint={t("dv2.low_ratings_hint")} />
        <Stat label={t("dv2.tickets_title")} tone="cyan" value={data.tickets ? data.tickets.length : "—"} hint={data.tickets ? t("dv2.open_n", { n: data.tickets.filter((x: any) => x.status !== "resolved").length }) : t("dv2.support_hidden")} />
        <Stat label={t("dv2.complaints_title")} tone="cyan" value={data.complaints ? data.complaints.length : "—"} hint={data.complaints ? t("dv2.open_n", { n: data.complaints.filter((x: any) => !["resolved", "closed"].includes(x.status)).length }) : t("dv2.support_hidden")} />
      </StatGrid>
      <Section title={t("dv2.ratings_received")} description={t("dv2.ratings_received_sub")} flush>
        <div className="border-b border-line px-4 py-3"><Segmented label={t("adm.rating_stars")} value={stars} onChange={(k) => { setStars(k); setPage(1); }} options={[{ key: "all", label: t("common.all") }, ...[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `★ ${n}`, count: data.distribution[n - 1].count }))]} /></div>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title={t("dv2.ratings_none")} hint={t("dv2.ratings_none_hint")} /></div> : (
          <Table stack bare dense label={t("dv2.ratings_received")} head={[t("adm.rating_stars"), t("adm.comment"), t("adm.rated_by"), t("req.ref"), t("common.date")]} footer={pagerFooter(page, data.total, SIZE, setPage)}>
            {data.items.map((r: any) => (
              <tr key={r.id} data-testid={`dv2-rating-${r.id}`}>
                <Td><Stars n={r.stars} /></Td><Td label={t("adm.comment")} className="max-w-96 whitespace-pre-wrap">{r.comment ?? <span className="text-muted">—</span>}</Td>
                <Td label={t("adm.rated_by")}>{r.rater.role === "business" && canBusiness ? <Link href={`/admin/companies/${r.rater.id}`} className="text-accent hover:underline">{r.rater.name}</Link> : r.rater.name}<span className="block text-xs text-muted">{t(`role.${r.rater.role}`)}</span></Td>
                <Td label={t("req.ref")}>{canRequest ? <Link href={`/admin/requests/${r.requestId}`} className="ltr-num text-accent hover:underline">{r.ref}</Link> : <span className="ltr-num">{r.ref}</span>}</Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(r.at, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("dv2.tickets_title")} description={t("dv2.tickets_sub")} flush>{support(data.tickets, "ticket")}</Section>
        <Section title={t("dv2.complaints_title")} description={t("dv2.complaints_sub")} flush>{support(data.complaints, "complaint")}</Section>
      </div>
    </div>
  );
}
