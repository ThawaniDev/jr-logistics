"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, CheckCheck, ChevronRight, FileCheck2, LifeBuoy, Package, Wallet, type LucideIcon } from "lucide-react";
import { mutate } from "swr";
import { useApi } from "@/components/ui/data";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, Segmented, Toolbar } from "@/components/ui";
import { notifHref } from "@/lib/notif-link";
import { notificationText } from "@/lib/notif-text";
import { useUser } from "@/components/layout/auth-context";
import { post } from "@/lib/api";
import { fmtDate, fmtTime, isoToRiyadhLocal } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { notifFamily, type NotifFamily } from "./admin-system-lib";

const DAY = 86_400_000;
/** Riyadh calendar day of a timestamp, as a number of days (so "today / yesterday" follow Saudi time, not the browser's). */
const dayOf = (iso: string) => Math.floor(new Date(`${isoToRiyadhLocal(iso)}:00Z`).getTime() / DAY);
const FAMILY: Record<NotifFamily, { icon: LucideIcon; chip: string }> = {
  support: { icon: LifeBuoy, chip: "bg-cyan/10 text-cyan" }, money: { icon: Wallet, chip: "bg-accent/10 text-accent" }, documents: { icon: FileCheck2, chip: "bg-gold/10 text-gold" },
  alert: { icon: AlertTriangle, chip: "bg-danger/10 text-danger" }, work: { icon: Package, chip: "bg-cyan/10 text-cyan" }, other: { icon: Bell, chip: "bg-line/50 text-muted" },
};

/** The notification list of every portal (admin, business, office, driver): all / unread filter, grouped by day, each card linking to where the user can act. */
export function NotificationsPage() {
  const { t, locale } = useI18n();
  const me = useUser(); const [page, setPage] = useState(1); const [filter, setFilter] = useState<"all" | "unread">("all");
  // Items that were unread when they appeared stay highlighted for this visit, even after they are marked read on the server.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const { data, error, mutate: reload } = useApi(`/notifications?page=${page}${filter === "unread" ? "&unread=1" : ""}`, { keepPreviousData: true });
  const refreshBell = () => mutate("/notifications?unread=1");
  const markRead = (ids?: string[]) => post("/notifications/read", ids ? { ids } : {}).then(() => { reload(); refreshBell(); }).catch(() => {});
  const unreadIds: string[] = (data?.items ?? []).filter((n: any) => !n.readAt).map((n: any) => n.id);
  const unreadKey = unreadIds.join(",");
  // Opening the page marks what is on screen as read after a short moment (only what the user could see, never the other pages).
  useEffect(() => {
    if (!unreadKey) return;
    const ids = unreadKey.split(",");
    const id = setTimeout(() => { setFresh((f) => new Set([...f, ...ids])); post("/notifications/read", { ids }).then(() => { reload(); mutate("/notifications?unread=1"); }).catch(() => {}); }, 3000);
    return () => clearTimeout(id);
  }, [unreadKey, reload]);
  if (error && !data) return <ErrorState error={error} retry={() => reload()} />;
  if (!data) return <PageLoading />;

  const today = dayOf(new Date().toISOString());
  const groups: Array<{ label: string; items: any[] }> = [];
  for (const n of data.items as any[]) {
    const d = dayOf(n.createdAt);
    const label = d === today ? t("ubz.today") : d === today - 1 ? t("ubz.yesterday") : fmtDate(n.createdAt, locale);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(n); else groups.push({ label, items: [n] });
  }
  const text = (n: any) => notificationText(t, n); // never shows a raw {placeholder}: missing params fall back to the short / cut / generic text

  return (
    <>
      <PageHeader title={t("nav.notifications")} subtitle={t("rdb.notif_sub")} icon={<Bell className="size-5" />}
        actions={data.unread > 0 && <Button variant="secondary" size="sm" onClick={() => markRead()} data-testid="rdb-notif-mark-all"><CheckCheck className="size-4" aria-hidden />{t("notif.mark_all")}</Button>} />
      <Toolbar><Segmented label={t("nav.notifications")} value={filter} onChange={(k) => { setFilter(k as "all" | "unread"); setPage(1); }} options={[{ key: "all", label: t("common.all") }, { key: "unread", label: t("ubz.unread"), count: data.unread || undefined }]} /></Toolbar>
      {data.items.length === 0 ? <EmptyState icon={<BellOff className="size-9" aria-hidden />} title={t(filter === "unread" ? "ubz.no_unread" : "notif.empty")} hint={filter === "unread" ? undefined : t("rdb.notif_empty_hint")}
        action={filter === "unread" ? <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>{t("common.view_all")}</Button> : undefined} /> : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</h2>
              <ul className="divide-y divide-line/70 overflow-hidden rounded-card border border-line bg-card">
                {g.items.map((n: any) => {
                  const href = notifHref(me.role, n.type, n.data);
                  const unread = !n.readAt || fresh.has(n.id);
                  const fam = FAMILY[notifFamily(n.type)]; const Icon = fam.icon;
                  const body = (
                    <>
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", fam.chip)} aria-hidden><Icon className="size-4" /></span>
                      <div className="min-w-0 flex-1"><p className={cn("text-sm", unread ? "font-semibold" : "font-medium text-ink/90")}>{text(n)}</p><p className="mt-0.5 text-xs text-muted"><span className="ltr-num">{fmtTime(n.createdAt, locale)}</span></p></div>
                      <span className={cn("size-2 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")} role={unread ? "img" : undefined} aria-label={unread ? t("a11y.unread") : undefined} />
                      {href && <ChevronRight className="size-4 shrink-0 text-muted rtl:rotate-180" aria-hidden />}
                    </>
                  );
                  const row = cn("flex items-center gap-3 px-4 py-3", unread && "bg-accent/[0.04]");
                  return (
                    <li key={n.id} data-testid="rdb-notif" data-unread={unread ? "1" : "0"}>
                      {href
                        ? <Link href={href} onClick={() => { if (!n.readAt) markRead([n.id]); }} className={cn(row, "transition hover:bg-bg2/60")}>{body}</Link>
                        : <div className={row}>{body}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </div>
      )}
    </>
  );
}
