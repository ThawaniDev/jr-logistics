"use client";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { Briefcase, CalendarClock, ChevronDown, Clock, Coins, MapPin, Star, Truck, UserCheck, UserX } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Pagination, ProgressBar, SearchBox, Segmented, Select, Stat, StatGrid, Toolbar } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { ApiError, post } from "@/lib/api";
import { friendlyErr } from "./driver-action";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { NotReadyNotice, assignErrText, reasonLabel } from "./office-shared";
import { OPP_FILTERS, isOppFilter, matchesQuery, oppCounts, oppMatches, openSlots, paginate, type OfficeOpp, type OppFilter } from "./office-lib";

const PAGE = 12;

function OppCard({ o, busy, error, onAssign }: { o: OfficeOpp; busy: boolean; error?: string; onAssign: (id: string, driverId: string) => Promise<boolean> }) {
  const { t, locale } = useI18n();
  const [pick, setPick] = useState(""); const [open, setOpen] = useState(false);
  const bad = o.ineligibleDrivers; const ready = o.eligibleDrivers.length > 0;
  const [now] = useState(() => Date.now()); // when the card appeared: enough to flag a window that closes within a day
  const closing = o.windowEndsAt ? Date.parse(o.windowEndsAt) - now : null;
  return (
    <article data-testid="office-opp" data-ref={o.ref} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{t(`svc.${o.service}`)} <span className="ltr-num text-xs font-normal text-muted">· {o.ref}</span></h2>
          {o.business && <p className="truncate text-sm text-muted">{o.business}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {o.preferred && <Badge tone="info"><Star className="size-3" aria-hidden />{t("office.preferred")}</Badge>}
          {ready ? <Badge tone="success"><UserCheck className="size-3" aria-hidden />{t("rdo.opp_ready_n", { n: o.eligibleDrivers.length })}</Badge> : <Badge tone="warn"><UserX className="size-3" aria-hidden />{t("rdo.opp_none")}</Badge>}
        </div>
      </header>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2"><CalendarClock className="size-4 shrink-0 text-cyan" aria-hidden /><dt className="sr-only">{t("req.starts")}</dt><dd>{fmtDateTime(o.startsAt, locale)}{o.durationDays && o.durationDays > 1 ? <span className="text-muted"> · {t("rdo.days_n", { n: o.durationDays })}</span> : null}</dd></div>
        <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-cyan" aria-hidden /><dt className="sr-only">{t("req.route")}</dt><dd>{t(`city.${o.pickupCity}`)} → {t(`city.${o.deliveryCity}`)}</dd></div>
        <div className="flex items-center gap-2"><Truck className="size-4 shrink-0 text-cyan" aria-hidden /><dt className="sr-only">{t("wizard.vehicle")}</dt><dd>{o.vehicleType ? t(`vehicle.${o.vehicleType}`) : "—"}{o.temperature ? ` · ${t(`temp.${o.temperature}`)}` : ""}</dd></div>
        {o.providerAmountCents != null && <div className="flex items-center gap-2"><Coins className="size-4 shrink-0 text-cyan" aria-hidden /><dt className="text-muted">{t("office.slot_pay")}:</dt><dd className="ltr-num font-bold text-accent">{fmtMoney(o.providerAmountCents, locale)}</dd></div>}
      </dl>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted"><span>{t("req.slots")}</span><span className="ltr-num tabular-nums">{o.slotsFilled}/{o.quantity} · {t("rdo.slots_open", { n: openSlots(o) })}</span></div>
        <ProgressBar value={o.slotsFilled} max={o.quantity} label={t("req.slots")} />
      </div>
      {o.windowEndsAt && <p className={cn("flex items-center gap-1.5 text-xs", closing !== null && closing < 24 * 3600_000 ? "font-medium text-gold" : "text-muted")}><Clock className="size-3.5" aria-hidden />{t("rdo.window_ends", { time: fmtDateTime(o.windowEndsAt, locale) })}</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {ready ? (
        <div className="flex gap-2">
          <div className="flex-1"><Select aria-label={t("office.pick_driver")} placeholder={t("office.pick_driver")} options={o.eligibleDrivers.map((d) => ({ value: d.id, label: d.name }))} value={pick} onChange={(e) => setPick(e.target.value)} /></div>
          <Button disabled={!pick} loading={busy} data-testid="office-assign" onClick={async () => { if (await onAssign(o.id, pick)) setPick(""); }}>{t("office.assign")}</Button>
        </div>
      ) : <p className="text-sm text-muted">{t("office.no_eligible")}</p>}
      {bad.length > 0 && (
        <div className="border-t border-line pt-2">
          <button type="button" aria-expanded={open} aria-controls={`inel-${o.id}`} onClick={() => setOpen(!open)} className="flex min-h-9 w-full items-center justify-between gap-2 text-start text-sm text-muted hover:text-ink">
            <span>{t("office.not_eligible_n", { n: bad.length })} · {open ? t("office.hide_reasons") : t("office.show_reasons")}</span>
            <ChevronDown className={cn("size-4 shrink-0 transition", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div id={`inel-${o.id}`} className="mt-2 space-y-2">
              <p className="text-xs text-muted">{t("office.ineligible_title")}</p>
              <ul className="space-y-2">{bad.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{d.name}</span>{d.reasons.map((r) => <Badge key={r} tone="warn">{reasonLabel(r, t)}</Badge>)}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Opportunities() {
  const { t, locale } = useI18n();
  const [filterRaw, setFilter] = useUrlState("filter", "all");
  const filter: OppFilter = isOppFilter(filterRaw) ? filterRaw : "all";
  const [q, setQ] = useState(""); const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null); const [errs, setErrs] = useState<Record<string, string>>({});
  const { data, error, mutate } = useApi<{ items: OfficeOpp[] }>("/office/opportunities", { refreshInterval: 30_000, revalidateOnFocus: true, shouldRetryOnError: false });
  const items = data?.items;
  const counts = useMemo(() => oppCounts(items ?? []), [items]);
  const rows = useMemo(() => (items ?? []).filter((o) => oppMatches(o, filter) && matchesQuery(q, o.ref, o.business, t(`city.${o.pickupCity}`), t(`city.${o.deliveryCity}`), t(`svc.${o.service}`))), [items, filter, q, t]);

  // Not verified / no accepted agreement yet: say what to do instead of a bare "not eligible".
  if (error instanceof ApiError && error.code === "NOT_ELIGIBLE") {
    const verification = (error.details as { verification?: string }).verification ?? "pending";
    return <><PageHeader title={t("nav.opportunities")} subtitle={t("shipadm.office_opps_sub")} /><NotReadyNotice verification={verification} /></>;
  }
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!items) return <PageLoading />;

  async function assign(id: string, driverId: string): Promise<boolean> {
    if (busy) return false; // one assignment at a time: a double tap must not assign twice
    setBusy(id); setErrs((e) => ({ ...e, [id]: "" }));
    try { await post(`/office/opportunities/${id}/assign`, { driverId }); toast.success(t("office.assigned")); void mutate(); return true; }
    catch (e) { setErrs((x) => ({ ...x, [id]: e instanceof ApiError ? assignErrText(e, t) : friendlyErr(e, t) })); void mutate(); return false; }
    finally { setBusy(null); }
  }
  const pageNo = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE)));
  const href = (f: OppFilter) => (f === "all" ? "/office/opportunities" : `/office/opportunities?filter=${f}`);
  const slots = items.reduce((a, o) => a + openSlots(o), 0);

  return (
    <>
      <PageHeader title={t("nav.opportunities")} subtitle={t("shipadm.office_opps_sub")} />
      <StatGrid cols={4} className="mb-5">
        <Stat label={t("rdo.opp_open")} value={fmtNum(counts.all, locale)} icon={<Briefcase className="size-5" />} hint={t("rdo.opp_open_hint", { n: slots })} href={href("all")} />
        <Stat label={t("rdo.opp_f_ready")} value={fmtNum(counts.ready, locale)} icon={<UserCheck className="size-5" />} tone="cyan" hint={t("rdo.opp_ready_hint")} href={href("ready")} />
        <Stat label={t("rdo.opp_f_none")} value={fmtNum(counts.none, locale)} icon={<UserX className="size-5" />} tone={counts.none > 0 ? "gold" : "muted"} hint={t("rdo.opp_none_hint")} href={href("none")} />
        <Stat label={t("rdo.opp_f_preferred")} value={fmtNum(counts.preferred, locale)} icon={<Star className="size-5" />} tone="muted" hint={t("rdo.opp_pref_hint")} href={href("preferred")} />
      </StatGrid>
      <Toolbar end={<span className="text-xs text-muted" aria-live="polite">{t("rdo.showing_n", { n: rows.length })}</span>}>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdo.opp_search")} label={t("rdo.opp_search")} />
        <Segmented label={t("rdo.opp_filter")} value={filter} onChange={(k) => { setFilter(k); setPage(1); }} options={OPP_FILTERS.map((f) => ({ key: f, label: t(`rdo.opp_f_${f}`), count: counts[f] }))} />
      </Toolbar>
      {items.length === 0 ? <EmptyState icon={<Briefcase className="size-9" aria-hidden />} title={t("office.no_opps")} hint={t("rdo.opp_empty_hint")} />
        : rows.length === 0 ? <EmptyState icon={<Briefcase className="size-9" aria-hidden />} title={t("common.no_results")} hint={t("rdo.opp_no_match")} action={<Button variant="secondary" onClick={() => { setQ(""); setFilter("all"); }}>{t("rdo.clear_filters")}</Button>} />
        : <>
          <div className="grid gap-4 lg:grid-cols-2">{paginate(rows, pageNo, PAGE).map((o) => <OppCard key={o.id} o={o} busy={busy === o.id} error={errs[o.id]} onAssign={assign} />)}</div>
          <Pagination page={pageNo} total={rows.length} pageSize={PAGE} onPage={setPage} />
        </>}
    </>
  );
}
export function OfficeOpportunities() { return <Suspense fallback={<PageLoading />}><Opportunities /></Suspense>; }
