"use client";
import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { Badge, Button, ErrorState, Input, Modal, Notice, PageLoading, Select, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { fullErr } from "./admin-common";
import {
  WAREHOUSE_DEFAULTS_FALLBACK, WAREHOUSE_SWITCHES, buildWarehousePatch, effectiveOf, isEmptyPatch, mapsLink, parseCoordinates, parseOneCoord, validLatLng, warehouseFormFrom,
  type Tri, type WarehouseForm, type WarehouseSwitch,
} from "./admin-fieldops-lib";

/**
 * Warehouse operations of one business (E.1): pin location and the four per-warehouse switches, each inheriting the platform default
 * until set. `GET/PATCH /admin/businesses/:id/warehouse` — editing needs `users.edit`, everyone else sees it read-only.
 */
export function WarehouseOpsPanel({ businessId, embedded, wide, onSaved }: { businessId: string; embedded?: boolean; wide?: boolean; onSaved?: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const canEdit = hasPerm(me, "users.edit");
  const { data, error, mutate } = useApi(`/admin/businesses/${businessId}/warehouse`, { shouldRetryOnError: false });
  const [draft, setDraft] = useState<WarehouseForm | null>(null); const [paste, setPaste] = useState(""); const [pasteState, setPasteState] = useState<"ok" | "bad" | null>(null);
  const [err, setErr] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;

  const form = draft ?? warehouseFormFrom(data);
  const edit = (next: WarehouseForm) => { setDraft(next); setErr(null); setSaved(false); };
  const defaults = { ...WAREHOUSE_DEFAULTS_FALLBACK, ...(data.defaults ?? {}) } as Record<WarehouseSwitch, boolean>;
  const { patch: body, problem } = buildWarehousePatch(data, form);
  const hasPin = data.lat != null && data.lng != null;
  const pin = (() => { const la = parseOneCoord(form.lat), ln = parseOneCoord(form.lng); return la !== null && ln !== null && validLatLng(la, ln) ? { lat: la, lng: ln } : null; })();
  const onText = (k: "lat" | "lng", v: string) => {
    // A "lat,lng" pair pasted into either box fills both.
    if (parseOneCoord(v) === null && /[,;\s]|maps|geo:/i.test(v)) { const p = parseCoordinates(v); if (p) { edit({ ...form, lat: String(p.lat), lng: String(p.lng) }); return; } }
    edit({ ...form, [k]: v });
  };
  const onPaste = (v: string) => {
    setPaste(v);
    if (!v.trim()) { setPasteState(null); return; }
    const p = parseCoordinates(v);
    if (p) { setPasteState("ok"); edit({ ...form, lat: String(p.lat), lng: String(p.lng) }); } else setPasteState("bad");
  };
  const tri = (k: WarehouseSwitch): Tri => form.ops[k];
  const label: Record<WarehouseSwitch, string> = {
    requireArrivalConfirmation: t("foa.wh_sw_arrival"), requireLoadingRecord: t("foa.wh_sw_loading"), requireDeliveryOtp: t("foa.wh_sw_otp"), requireSignature: t("foa.wh_sw_signature"),
  };
  const hint: Record<WarehouseSwitch, string> = {
    requireArrivalConfirmation: t("foa.wh_sw_arrival_hint"), requireLoadingRecord: t("foa.wh_sw_loading_hint"), requireDeliveryOtp: t("foa.wh_sw_otp_hint"), requireSignature: t("foa.wh_sw_signature_hint"),
  };
  const onOff = (v: boolean) => t(v ? "foa.on" : "foa.off");
  const dirty = !isEmptyPatch(body);
  const save = () => a.run("wh", () => patch(`/admin/businesses/${businessId}/warehouse`, body), {
    success: "foa.wh_saved", onDone: () => { setDraft(null); setPaste(""); setPasteState(null); setSaved(true); mutate(); onSaved?.(); }, onError: (e) => setErr(fullErr(e, t)),
  });

  return (
    <div className="space-y-4" data-testid="foa-wh-panel">
      {!embedded && <Notice tone="info">{t("foa.wh_intro")}</Notice>}
      {!canEdit && <Notice tone="warn">{t("foa.wh_readonly")}</Notice>}

      <div className={wide ? "grid gap-6 lg:grid-cols-2 lg:items-start" : "space-y-4"}>
      <section className={cn("space-y-3", wide && "rounded-xl border border-line p-4")} aria-labelledby="foa-wh-loc">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="foa-wh-loc" className="text-sm font-semibold">{t("foa.wh_location")}</h3>
          <Badge tone={hasPin ? "success" : "warn"}><MapPin className="size-3" aria-hidden /><span data-testid="foa-wh-status">{hasPin ? t("foa.wh_loc_set") : t("foa.wh_loc_missing")}</span></Badge></div>
        <p className="text-xs text-muted">{t("foa.wh_location_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input data-testid="foa-wh-lat" label={t("foa.wh_lat")} ltr inputMode="decimal" placeholder="24.713600" value={form.lat} disabled={!canEdit} onChange={(e) => onText("lat", e.target.value)} />
          <Input data-testid="foa-wh-lng" label={t("foa.wh_lng")} ltr inputMode="decimal" placeholder="46.675300" value={form.lng} disabled={!canEdit} onChange={(e) => onText("lng", e.target.value)} />
        </div>
        {canEdit && <Input data-testid="foa-wh-paste" label={t("foa.wh_paste")} ltr value={paste} placeholder="https://maps.google.com/…  |  24.7136, 46.6753" onChange={(e) => onPaste(e.target.value)}
          error={pasteState === "bad" ? t("foa.wh_paste_bad") : undefined} hint={pasteState === "ok" ? t("foa.wh_paste_ok") : t("foa.wh_paste_hint")} />}
        {pin
          ? <a data-testid="foa-wh-map-link" href={mapsLink(pin.lat, pin.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"><ExternalLink className="size-4" aria-hidden />{t("foa.wh_view_map")}</a>
          : <p className="text-xs text-muted">{t("foa.wh_view_map_na")}</p>}
        {problem && <p role="alert" className="text-xs text-danger">{t(problem === "coords_pair" ? "foa.wh_err_pair" : "foa.wh_err_coords")}</p>}
      </section>

      <section className={cn("space-y-3", wide && "rounded-xl border border-line p-4")} aria-labelledby="foa-wh-ops">
        <h3 id="foa-wh-ops" className="text-sm font-semibold">{t("foa.wh_switches")}</h3>
        <p className="text-xs text-muted">{t("foa.wh_switches_hint")}</p>
        <div className="space-y-3">
          {WAREHOUSE_SWITCHES.map((k) => {
            const eff = effectiveOf(tri(k), defaults[k]);
            return (
              <div key={k} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{label[k]}</p><p className="text-xs text-muted">{hint[k]}</p></div>
                  <Badge tone={eff ? "success" : "neutral"}><span data-testid={`foa-wh-effective-${k}`}>{t("foa.wh_effective", { v: onOff(eff) })}</span></Badge></div>
                <div className="mt-2 max-w-sm">
                  <Select data-testid={`foa-wh-sw-${k}`} aria-label={label[k]} disabled={!canEdit} value={tri(k)}
                    onChange={(e) => edit({ ...form, ops: { ...form.ops, [k]: e.target.value as Tri } })}
                    options={[{ value: "inherit", label: t("foa.wh_inherit", { v: onOff(defaults[k]) }) }, { value: "on", label: t("foa.on") }, { value: "off", label: t("foa.off") }]} />
                </div>
              </div>);
          })}
        </div>
      </section>
      </div>

      {err && <Notice tone="danger">{err}</Notice>}
      {saved && !dirty && <Notice tone="success"><span data-testid="foa-wh-saved">{t("foa.wh_saved")}</span></Notice>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="foa-wh-save" loading={a.is("wh")} disabled={!dirty || !!problem} onClick={save}>{t("common.save")}</Button>
          {dirty && <Button variant="ghost" disabled={a.is("wh")} onClick={() => { setDraft(null); setPaste(""); setPasteState(null); setErr(null); }}>{t("uxa.discard_changes")}</Button>}
          <span className="text-xs text-muted">{t("foa.wh_audit_note")}</span>
        </div>)}
    </div>
  );
}

/** Dialog wrapper used from the business list. */
export function WarehouseOpsDialog({ business, onClose }: { business: { id: string; name: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open={!!business} onClose={onClose} title={business ? t("foa.wh_title_for", { name: business.name }) : ""} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      {business && <WarehouseOpsPanel key={business.id} businessId={business.id} />}
    </Modal>
  );
}
