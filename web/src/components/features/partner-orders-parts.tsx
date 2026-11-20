"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Inbox, Plug, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Modal, Notice, Select, Textarea, errText, useAction, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { providerName, type Connection, type OrderState, type PartnerOrder, type PartnerOrderDetail } from "./business-shipments-partner";
import { cityLabel, cityVerdict, fromOrdersHref, groupProblems, idsByCity, importableConnections, refList, type ManifestProblem, type OrdersManifest } from "./partner-orders-lib";

/** Shared pieces of the Incoming orders views (business `/integrations`, staff `/admin/integrations`). */

export const BUSINESS_API = "/integrations";
export const ADMIN_API = "/admin/integrations";
export const isAdminApi = (apiBase: string) => apiBase.startsWith("/admin");
/** Where the list / an order / a JR request lives in the portal that is looking at it. */
export const ordersHome = (apiBase: string) => (isAdminApi(apiBase) ? "/admin/integrations/orders" : "/business/integrations/orders");
export const requestHref = (apiBase: string, requestId: string) => (isAdminApi(apiBase) ? `/admin/requests/${requestId}` : `/business/requests/${requestId}`);

/**
 * What the viewer may do. Companies manage their own orders. Staff: viewing needs `integrations.view` (or the older `requests.view`),
 * set aside / restore / refresh / import need `integrations.manage`. Creating a JR delivery order from orders is the company's job only.
 */
export function useOrderPerms(apiBase: string) {
  const me = useUser();
  if (!isAdminApi(apiBase)) return { view: true, manage: true, create: true, companies: false };
  return {
    view: hasPerm(me, "integrations.view") || hasPerm(me, "requests.view"),
    manage: hasPerm(me, "integrations.manage"),
    create: false,
    companies: ["users.view", "verification.manage", "offices.view"].some((p) => hasPerm(me, p)),
  };
}

/** The connections the viewer can see: the company's own, or (staff) every company's, optionally one company's. */
export function useOrderConnections(apiBase: string, businessId = "") {
  const admin = isAdminApi(apiBase);
  const qs = new URLSearchParams({ pageSize: "200" }); if (businessId) qs.set("businessId", businessId);
  const r = useApi<{ items: Connection[] }>(admin ? `/admin/integrations/connections?${qs}` : "/integrations/connections");
  return { items: r.data?.items ?? [], loaded: !!r.data || !!r.error, error: r.error, mutate: r.mutate };
}

/** City names of the catalog (JR keys → name in each language). */
export function useCityNames(): { names: Record<string, string>; options: Array<{ value: string; label: string }> } {
  const { locale } = useI18n();
  const { data } = useApi<{ cities: Array<{ key: string; delivery?: boolean } & Record<string, unknown>> }>("/catalog");
  const cities = data?.cities ?? [];
  const label = (c: Record<string, unknown>) => String(c[locale] ?? c.en ?? c.key);
  return { names: Object.fromEntries(cities.map((c) => [c.key, label(c)])), options: cities.filter((c) => c.delivery !== false).map((c) => ({ value: c.key, label: label(c) })) };
}

const STATE_TONE: Record<OrderState, Tone> = { open: "warn", in_jr: "info", delivered: "success", undelivered: "danger", cancelled: "neutral" };
export function OrderStateBadge({ state }: { state: OrderState }) {
  const { t } = useI18n();
  return <Badge tone={STATE_TONE[state] ?? "neutral"}><span data-testid="order-state" data-state={state}>{t(`iord.state_${state}`)}</span></Badge>;
}

export function ProviderBadge({ o }: { o: Pick<PartnerOrder, "provider" | "providerLabel"> }) {
  const { t } = useI18n();
  return <Badge tone="info" className="max-w-[10rem]"><span className="truncate">{providerName(t, o.provider, o.providerLabel)}</span></Badge>;
}

/** Cash on delivery: amount, "prepaid" (the partner said 0) or "not stated" (the partner did not say). */
export function CodValue({ cents, className }: { cents: number | null; className?: string }) {
  const { t, locale } = useI18n();
  if (cents == null) return <span className={className ?? "text-xs text-muted"} data-testid="cod-unknown">{t("iord.cod_not_stated")}</span>;
  if (cents === 0) return <span className={className ?? "text-xs text-muted"}>{t("iord.cod_prepaid")}</span>;
  return <span className={className ?? "ltr-num font-medium text-gold"}>{fmtMoney(cents, locale)}</span>;
}

/** The JR city it was matched to, or what the partner sent with a warning (JR does not serve it, or the name was not recognised). */
export function CityValue({ o, names }: { o: Pick<PartnerOrder, "city" | "cityRaw">; names: Record<string, string> }) {
  const { t } = useI18n();
  if (o.city) return <span>{cityLabel(t, o.city, names)}</span>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {o.cityRaw && <span dir="auto" className="text-muted">{o.cityRaw}</span>}
      <Badge tone="warn"><AlertTriangle className="size-3" aria-hidden /><span data-testid="city-unmatched">{o.cityRaw ? t("iord.city_unmatched") : t("iord.no_city")}</span></Badge>
    </span>
  );
}

export function PhoneValue({ o }: { o: Pick<PartnerOrder, "recipientPhone" | "phoneValid"> }) {
  const { t } = useI18n();
  if (!o.recipientPhone) return <Badge tone="warn">{t("iord.phone_missing")}</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="ltr-num" dir="ltr">{o.recipientPhone}</span>
      {!o.phoneValid && <Badge tone="danger"><span data-testid="phone-invalid">{t("iord.phone_invalid")}</span></Badge>}
    </span>
  );
}

// ───────── set aside (dismiss) ─────────
/**
 * "Set aside" with an optional reason. Carrier partners (Omniful, Fastcoo) are told JR will not deliver it (their "cancelled" update,
 * when switched on in Sync & statuses); merchant systems are NOT told (their APIs have no carrier refusal), so the dialog says so.
 */
export function DismissDialog({ apiBase, orders, onClose, onDone }: { apiBase: string; orders: Array<Pick<PartnerOrder, "id" | "provider" | "providerLabel"> & { mode?: PartnerOrder["mode"] }>; onClose: () => void; onDone: (n: number) => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const [reason, setReason] = useState("");
  const nameOf = (o: Pick<PartnerOrder, "provider" | "providerLabel">) => providerName(t, o.provider, o.providerLabel);
  const names = [...new Set(orders.filter((o) => o.mode !== "carrier").map(nameOf))].join(", ");
  const carrierNames = [...new Set(orders.filter((o) => o.mode === "carrier").map(nameOf))].join(", ");
  const go = () => a.run("dismiss", () => post<{ dismissed: number }>(`${apiBase}/orders/dismiss`, { ids: orders.map((o) => o.id), ...(reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}) }), {
    onDone: (r) => { toast.success(t("iord.set_aside_done", { n: fmtNum(r.dismissed, locale) })); onDone(r.dismissed); },
  });
  return (
    <Modal open onClose={onClose} busy={a.any} title={t("iord.dismiss_title", { n: fmtNum(orders.length, locale) })}
      footer={<><Button variant="ghost" onClick={onClose} disabled={a.any}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("dismiss")} onClick={go} data-testid="dismiss-confirm">{t("iord.dismiss_confirm")}</Button></>}>
      <p className="text-sm text-muted">{t("iord.dismiss_body")}</p>
      {carrierNames && <Notice tone="info" title={t("iord.dismiss_carrier_title", { name: carrierNames })}><span data-testid="dismiss-carrier">{t("iord.dismiss_carrier", { name: carrierNames })}</span></Notice>}
      {names && <Notice tone="warn" title={t("iord.dismiss_warn_title", { name: names })}><span data-testid="dismiss-warning">{t("iord.dismiss_warn", { name: names })}</span></Notice>}
      <Textarea label={t("iord.dismiss_reason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} placeholder={t("iord.dismiss_reason_ph")} data-testid="dismiss-reason" />
    </Modal>
  );
}

/** Restores orders that were set aside (never ones the partner cancelled). Returns the runner and its busy flag. */
export function useRestore(apiBase: string, onDone: (n: number) => void) {
  const { t, locale } = useI18n(); const a = useAction();
  const run = (ids: string[]) => a.run("restore", () => post<{ restored: number }>(`${apiBase}/orders/restore`, { ids }), {
    onDone: (r) => { toast.success(t("iord.restored", { n: fmtNum(r.restored, locale) })); onDone(r.restored); },
  });
  return { run, busy: a.is("restore") };
}

// ───────── create a JR delivery order from orders (business only) ─────────
/**
 * Asks the server for the manifest first (so a mixed-city selection is refused before anything else), then opens the request form with the
 * usable orders (`?fromOrders=`). The form loads the manifest again itself, so a stale tab never books outdated details.
 */
export function useCreateFromOrders(apiBase: string) {
  const { t } = useI18n(); const router = useRouter(); const a = useAction();
  const [mixed, setMixed] = useState<OrdersManifest | null>(null);
  const start = (ids: string[]) => a.run("create", () => post<OrdersManifest>(`${apiBase}/orders/manifest`, { ids }), {
    onDone: (m) => {
      if (cityVerdict(m).kind === "mixed") { setMixed(m); return; }
      const usable = m.rows.map((r) => r.orderId);
      if (usable.length === 0) { toast.error(t("iord.none_open")); return; }
      router.push(fromOrdersHref(usable));
    },
  });
  const dialog = mixed ? <MixedCitiesDialog m={mixed} onClose={() => setMixed(null)} onPick={(ids) => { setMixed(null); router.push(fromOrdersHref(ids)); }} /> : null;
  return { start, busy: a.is("create"), dialog };
}

/** One JR delivery order serves one city: the selection is refused, with one button per city to go on with that city's orders only. */
export function MixedCitiesDialog({ m, onClose, onPick }: { m: OrdersManifest; onClose: () => void; onPick: (ids: string[]) => void }) {
  const { t } = useI18n();
  return (
    <Modal open onClose={onClose} title={t("iord.mixed_title")} footer={<Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}>
      <MixedCitiesBody m={m} onPick={onPick} />
    </Modal>
  );
}
/** The refusal itself (also shown inline on the request form when a link carries orders of several cities). */
export function MixedCitiesBody({ m, onPick }: { m: OrdersManifest; onPick: (ids: string[]) => void }) {
  const { t, locale } = useI18n(); const { names } = useCityNames();
  const all = { ...m.cityNames, ...names };
  const groups = idsByCity(m);
  const list = groups.map((g) => `${cityLabel(t, g.city, all)} (${fmtNum(g.ids.length, locale)})`).join(locale === "en" ? ", " : "، ");
  return (
    <div className="space-y-4">
      <Notice tone="danger"><span data-testid="mixed-cities">{t("iord.mixed_body", { n: fmtNum(groups.length, locale), cities: list })}</span></Notice>
      <p className="text-sm text-muted">{t("iord.mixed_hint")}</p>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => <Button key={g.city} variant="secondary" size="sm" onClick={() => onPick(g.ids)} data-testid={`mixed-pick-${g.city}`}>{t("iord.mixed_keep", { city: cityLabel(t, g.city, all), n: fmtNum(g.ids.length, locale) })}</Button>)}
      </div>
    </div>
  );
}

// ───────── problems the manifest reported ─────────
/** Incomplete details, unmatched cities, bad phones and orders left out — each with the order numbers concerned. */
export function ProblemsNotice({ problems, title }: { problems: ManifestProblem[]; title?: string }) {
  const { t, locale } = useI18n();
  const groups = groupProblems(problems);
  if (groups.length === 0) return null;
  return (
    <Notice tone="warn" title={title ?? t("iord.prob_title")}>
      <ul className="mt-1 space-y-1" data-testid="order-problems">
        {groups.map((g) => {
          const { shown, more } = refList(g.refs);
          const refs = shown.join(", ") + (more > 0 ? ` ${t("iord.and_more", { n: fmtNum(more, locale) })}` : "");
          return <li key={g.issue} data-issue={g.issue}><span className="font-medium">{t(`iord.prob_${g.issue}`)}</span>: <span className="ltr-num" dir="ltr">{refs}</span></li>;
        })}
      </ul>
    </Notice>
  );
}

// ───────── import one order by its number ─────────
export function ImportOrderDialog({ apiBase, connections, onClose, onImported }: { apiBase: string; connections: Connection[]; onClose: () => void; onImported: (o: PartnerOrderDetail) => void }) {
  const { t } = useI18n(); const a = useAction();
  const usable = importableConnections(connections);
  const [connId, setConnId] = useState(usable[0]?.id ?? "");
  const [ref, setRef] = useState(""); const [failure, setFailure] = useState<string | null>(null);
  const conn = usable.find((c) => c.id === connId) ?? usable[0];
  const label = (c: Connection) => `${c.name} · ${providerName(t, c.provider, c.providerLabel)}${c.business ? ` · ${c.business}` : ""}`;
  const go = () => { if (!conn || !ref.trim()) return; setFailure(null); void a.run("import", () => post<PartnerOrderDetail>(`${apiBase}/connections/${conn.id}/import`, { reference: ref.trim().slice(0, 80) }), { onDone: onImported, onError: (e) => setFailure(errText(e, t)) }); };
  return (
    <Modal open onClose={onClose} busy={a.any} title={t("iord.import_title")}
      footer={<><Button variant="ghost" onClick={onClose} disabled={a.any}>{t("common.cancel")}</Button><Button loading={a.is("import")} disabled={!conn || !ref.trim()} onClick={go} data-testid="import-order-go"><Download className="size-4" aria-hidden />{t("iord.import_go")}</Button></>}>
      {!conn ? <Notice tone="info">{t("iord.import_none")}</Notice> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(); }}>
          {usable.length > 1 && <Select label={t("iord.import_conn")} value={conn.id} onChange={(e) => setConnId(e.target.value)} options={usable.map((c) => ({ value: c.id, label: label(c) }))} data-testid="import-order-conn" />}
          <Input label={t("iord.import_ref")} ltr value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} autoFocus required hint={t("iord.import_ref_hint", { name: usable.length > 1 ? conn.name : label(conn) })} data-testid="import-order-ref" />
          {failure && <Notice tone="danger">{failure}</Notice>}
        </form>
      )}
    </Modal>
  );
}

// ───────── empty state: how orders arrive ─────────
/** Explains the three ways orders reach this list, highlighting the systems the company actually connected. */
export function ArrivalHelp({ connections, integrationsHref, action }: { connections: Connection[]; integrationsHref: string | null; action?: ReactNode }) {
  const { t } = useI18n();
  const modes = new Set<string>(connections.map((c) => c.capabilities?.mode ?? c.mode ?? "").filter(Boolean));
  const named = (mode: string) => connections.filter((c) => (c.capabilities?.mode ?? c.mode) === mode).map((c) => c.name).join(", ");
  const rows = [
    { mode: "carrier", icon: <Truck className="size-4" aria-hidden />, text: t("iord.how_carrier") },
    { mode: "merchant", icon: <Download className="size-4" aria-hidden />, text: t("iord.how_merchant") },
    { mode: "custom", icon: <Plug className="size-4" aria-hidden />, text: t("iord.how_custom") },
  ];
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10" data-testid="orders-empty">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 text-center">
        <Inbox className="size-9 text-muted" aria-hidden />
        <p className="font-semibold">{connections.length === 0 ? t("iord.no_connections_title") : t("iord.empty_title")}</p>
        <p className="max-w-md text-sm text-muted">{connections.length === 0 ? t("iord.no_connections_hint") : t("iord.empty_hint")}</p>
      </div>
      <div className="mx-auto mt-6 max-w-2xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t("iord.how_title")}</p>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.mode} data-mode={r.mode} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${modes.has(r.mode) ? "border-accent/40 bg-accent/5" : "border-line bg-bg2/40"}`}>
              <span className="mt-0.5 text-cyan">{r.icon}</span>
              <span className="min-w-0"><span>{r.text}</span>{modes.has(r.mode) && <span className="mt-0.5 block text-xs text-accent">{t("iord.how_yours", { names: named(r.mode) })}</span>}</span>
            </li>
          ))}
        </ul>
        {(integrationsHref || action) && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {action}
            {integrationsHref && <Link href={integrationsHref}><Button variant="secondary" size="sm"><Plug className="size-4" aria-hidden />{t("iord.go_integrations")}</Button></Link>}
          </div>
        )}
      </div>
    </div>
  );
}
