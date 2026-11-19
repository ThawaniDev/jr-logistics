"use client";
import { useState } from "react";
import { Link2Off } from "lucide-react";
import { Badge, Button, CellPair, ErrorState, Section, SearchBox, Segmented, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { UnlinkOfficeModal } from "./admin-drivers-actions";
import { ListEmpty, LoadingRows, pagerFooter } from "./admin-offices-common";
import { DRIVER_STATES, apiFilter, driverSuspension, ratingText, type DriverState } from "./admin-offices-lib";
import { fmtDate } from "@/lib/format";

const SIZE = 10;

/** Drivers affiliated with one office, with the unlink action (`POST /admin/drivers/:id/unlink-office`, needs `offices.manage`). */
export function OfficeDriversTab({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [state, setState] = useState<DriverState>("all"); const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const [unlink, setUnlink] = useState<{ id: string; name: string } | null>(null);
  const office = useApi(`/admin/offices/${id}`);
  const { data, error, mutate } = useApi(`/admin/offices/${id}/drivers${qs({ q: dq, state: apiFilter(state), page, pageSize: SIZE })}`, { keepPreviousData: true });
  const canOpen = hasAny(me, "drivers.view", "users.view"), canUnlink = hasPerm(me, "offices.manage");
  const rows: any[] = data?.items ?? []; const loading = !data && !error;
  const head = [t("adm.col_driver"), t("wizard.vehicle"), t("driver.rating"), { label: t("driver.completed"), align: "end" as const }, t("adm.availability"), t("verify.title"), t("common.status"), ...(canUnlink ? [{ label: t("adm.unlink_office"), srOnly: true }] : [])];
  const labels: Record<DriverState, string> = { all: t("common.all"), available: t("map.available"), pending: t("rdq.f_pending_verification"), suspended: t("status.suspended") };
  const filtered = state !== "all" || !!dq;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  const reload = () => { mutate(); office.mutate(); };
  return (
    <Section title={t("req.drivers")} description={t("rdq.office_drivers_sub")} flush>
      <Table stack bare dense label={t("req.drivers")} head={head}
        toolbar={<>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdq.search_drivers")} label={t("rdq.search_drivers")} />
          <Segmented label={t("common.status")} value={state} onChange={(k) => { setState(k as DriverState); setPage(1); }} options={DRIVER_STATES.map((k) => ({ key: k, label: labels[k] }))} />
        </>}
        empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={() => { setQ(""); setState("all"); }} title={t("office.no_drivers")} hint={t("rdq.office_drivers_none_hint")} /> : undefined}
        footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
        {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.map((d) => {
          const sus = driverSuspension(d);
          return (
            <tr key={d.id} data-testid={`rdq-office-driver-${d.id}`}>
              <Td><CellPair title={d.name} href={canOpen ? `/admin/drivers/${d.id}` : undefined} sub={<span className="ltr-num">{d.phone ?? "—"}</span>} /></Td>
              <Td label={t("wizard.vehicle")}>{d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"}<span className="block text-xs text-muted">{tx(`city.${d.city}`, d.city)}</span></Td>
              <Td label={t("driver.rating")}>{ratingText(d.rating)}</Td>
              <Td label={t("driver.completed")} num>{d.jobsCompleted}</Td>
              <Td label={t("adm.availability")}>{d.onJob ? <Badge tone="info">{t("office.on_job")}</Badge> : <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge>}</Td>
              <Td label={t("verify.title")}><StatusBadge status={d.verificationStatus} /></Td>
              <Td label={t("common.status")}>{sus.active ? <Badge tone="danger" className="whitespace-nowrap">{sus.until ? `${t("driver.suspended")} · ${fmtDate(sus.until, locale)}` : t("status.suspended")}</Badge> : <StatusBadge status={d.status} />}</Td>
              {canUnlink && <Td align="end"><Button size="sm" variant="ghost" data-testid={`rdq-office-unlink-${d.id}`} onClick={() => setUnlink({ id: d.id, name: d.name })}><Link2Off className="size-4" aria-hidden />{t("office.unlink")}</Button></Td>}
            </tr>
          );
        })}
      </Table>
      <UnlinkOfficeModal driver={unlink} office={office.data?.officeName ?? ""} onClose={() => setUnlink(null)} onDone={reload} />
    </Section>
  );
}
