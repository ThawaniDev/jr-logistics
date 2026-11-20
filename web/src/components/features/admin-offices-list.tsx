"use client";
import { useState } from "react";
import { Building2, Handshake, Hourglass, ShieldCheck, ShieldOff, Truck } from "lucide-react";
import { CellPair, ErrorState, PageHeader, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { AgreementBadge, ListEmpty, LoadingRows, Money, RowLink, pagerFooter } from "./admin-offices-common";
import { OFFICE_STATES, apiFilter, parseAgreementFilter, parseOfficeState } from "./admin-offices-lib";
import { AddAccountButton } from "./admin-create-pages";

const SIZE = 25;

/** `/admin/offices`: KPI row, filters (verification state + agreement, both deep-linkable) and the offices table. */
export function OfficesList() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [stateRaw, setState] = useUrlState("state", "all"); const [agrRaw, setAgr] = useUrlState("agreement");
  const state = parseOfficeState(stateRaw), agr = parseAgreementFilter(agrRaw);
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const sum = useApi("/admin/offices/summary", { keepPreviousData: true });
  const list = useApi(`/admin/offices${qs({ q: dq, state: apiFilter(state), agreement: agr, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const s = sum.data; const rows: any[] = list.data?.items ?? [];
  const money = rows.length > 0 && rows[0].pendingPayoutCents !== null; // the API leaves payout money out for staff without a finance-type permission
  const canDrivers = hasAny(me, "drivers.view");
  const filtered = state !== "all" || !!agr || !!dq;
  const reset = () => { setQ(""); setState("all"); setAgr(""); setPage(1); };
  const label = (k: string) => (k === "review" ? t("rdq.f_review") : k === "all" ? t("common.all") : t(`status.${k}`));
  const loading = !list.data && !list.error;
  const head = [t("rdq.col_office"), t("reg.city"), { label: t("req.drivers"), align: "end" as const }, { label: t("office.active_jobs"), align: "end" as const }, ...(money ? [{ label: t("rdq.col_pending_payout"), align: "end" as const }] : []),
    t("nav.agreement"), t("verify.title"), t("common.status"), t("rdq.col_joined"), { label: t("common.open"), srOnly: true }];
  const n = (v: number | undefined) => (sum.error ? "—" : v ?? 0);

  return (
    <>
      <PageHeader title={t("nav.offices")} subtitle={t("rdq.offices_sub")} icon={<Building2 className="size-5" />} actions={<AddAccountButton kind="office" />} />
      <section aria-label={t("rdq.kpis")} className="mb-5">
        <StatGrid cols={6}>
          <Stat label={t("rdq.kpi_offices")} value={n(s?.offices)} loading={!s && !sum.error} icon={<Building2 className="size-5" />} href="/admin/offices" hint={t("rdq.kpi_offices_hint")} tone="accent" />
          <Stat label={t("status.verified")} value={n(s?.verified)} loading={!s && !sum.error} icon={<ShieldCheck className="size-5" />} href="/admin/offices?state=verified" hint={t("rdq.kpi_verified_hint")} tone="accent" />
          <Stat label={t("rdq.kpi_review")} value={n(s?.review)} loading={!s && !sum.error} icon={<Hourglass className="size-5" />} href="/admin/offices?state=review" hint={t("rdq.kpi_review_hint")} tone={s?.review ? "gold" : "muted"} />
          <Stat label={t("status.suspended")} value={n(s?.suspended)} loading={!s && !sum.error} icon={<ShieldOff className="size-5" />} href="/admin/offices?state=suspended" hint={t("rdq.kpi_suspended_hint")} tone={s?.suspended ? "danger" : "muted"} />
          <Stat label={t("rdq.kpi_drivers")} value={n(s?.drivers)} loading={!s && !sum.error} icon={<Truck className="size-5" />} href={canDrivers ? "/admin/drivers?link=office" : undefined} hint={t("rdq.kpi_drivers_hint")} tone="cyan" />
          <Stat label={t("rdq.kpi_agreements")} value={n(s?.pendingAgreements)} loading={!s && !sum.error} icon={<Handshake className="size-5" />} href="/admin/offices?agreement=pending" hint={t("rdq.kpi_agreements_hint")} tone={s?.pendingAgreements ? "gold" : "muted"} />
        </StatGrid>
      </section>

      {list.error && !list.data ? <ErrorState error={list.error} retry={() => list.mutate()} /> : (
        <Table stack label={t("nav.offices")} head={head}
          toolbar={<>
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdq.search_offices")} label={t("rdq.search_offices")} />
            <Segmented label={t("verify.title")} value={state} onChange={(k) => { setState(k); setPage(1); }}
              options={OFFICE_STATES.map((k) => ({ key: k, label: label(k), count: k === "all" ? s?.offices : s?.[k] }))} />
            <div className="w-52"><Select aria-label={t("nav.agreement")} placeholder={t("rdq.agr_any")} value={agr} onChange={(e) => { setAgr(e.target.value); setPage(1); }} options={[{ value: "pending", label: t("adm.agr_pending") }, { value: "none", label: t("rdq.agr_none") }]} /></div>
          </>}
          empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={reset} title={t("rdq.offices_none")} hint={t("rdq.offices_none_hint")} /> : undefined}
          footer={list.data ? pagerFooter(page, list.data.total, SIZE, setPage) : undefined}>
          {loading ? <LoadingRows cols={head.length} /> : rows.map((o) => (
            <tr key={o.id} data-testid={`rdq-office-row-${o.id}`}>
              <Td><CellPair title={o.officeName} href={`/admin/offices/${o.id}`} sub={<>{o.contact} · <span className="ltr-num">{o.phone ?? o.email ?? "—"}</span></>} /></Td>
              <Td label={t("reg.city")}>{tx(`city.${o.city}`, o.city)}</Td>
              <Td label={t("req.drivers")} num>{o.drivers}{o.drivers > 0 && <span className="ms-1 text-xs text-muted">({t("rdq.n_available", { n: o.availableDrivers })})</span>}</Td>
              <Td label={t("office.active_jobs")} num>{o.activeJobs}</Td>
              {money && <Td label={t("rdq.col_pending_payout")} align="end">{o.pendingPayoutCents ? <Money cents={o.pendingPayoutCents} /> : "—"}</Td>}
              <Td label={t("nav.agreement")}><AgreementBadge status={o.agreementStatus} expiresAt={o.agreementExpiresAt} /></Td>
              <Td label={t("verify.title")}><StatusBadge status={o.verificationStatus} /></Td>
              <Td label={t("common.status")}><StatusBadge status={o.status} /></Td>
              <Td label={t("rdq.col_joined")} className="whitespace-nowrap text-muted">{fmtDate(o.createdAt, locale)}</Td>
              <Td align="end"><RowLink href={`/admin/offices/${o.id}`} label={t("rdq.open_named", { name: o.officeName })} testid={`rdq-office-open-${o.id}`} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
