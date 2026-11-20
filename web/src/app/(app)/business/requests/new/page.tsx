"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Bike, Car, CarFront, CheckCircle2, Info } from "lucide-react";
import { Button, Card, Checkbox, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Section, Select, Stepper, Textarea, KV, errText, fieldErrors, useAction, Spinner } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { api, post, patch, ApiError } from "@/lib/api";
import { fmtMoney, fmtNum, isoToRiyadhLocal, riyadhLocalToIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { ManifestEditor, type ServerRowErrors } from "@/components/features/business-shipments-manifest";
import { DetailsModeSwitch } from "@/components/features/business-shipments-later";
import { b2bEnabledOf } from "@/components/features/business-shipments-policy";
import { WarehouseLocationNotice } from "@/components/features/business-warehouse";
import { sumCod } from "@/components/features/business-fieldops-lib";
import { OrdersPrefill, OrdersPrefillNotice, seedForm, type OrdersSeed } from "@/components/features/partner-orders-prefill";
import { DEFAULT_PER_DRIVER, MAX_ROWS, countMissing, duplicateRefs, loadAllShipments, mapServerRowErrors, splitServerManifest, toWire, validateRow, type LoadedManifest, type ManifestRow } from "@/components/features/business-shipments-lib";

const SVC_ICON = { delivery_driver: Bike, car_with_driver: CarFront, car_without_driver: Car } as const;
const todayLocal = () => { const d = new Date(Date.now() + 3 * 3600_000 + 3600_000); return d.toISOString().slice(0, 16); };

export default function NewRequestPage() { return <Suspense fallback={<PageLoading />}><DraftLoader /></Suspense>; }

/** `?draft=<id>` opens the wizard pre-filled from that draft; saving then PATCHes it instead of creating a new request. `?fromOrders=<ids>` starts it from Incoming orders. */
function DraftLoader() {
  const { t } = useI18n(); const sp = useSearchParams(); const id = sp.get("draft"); const fromOrders = sp.get("fromOrders");
  const { data, error, mutate } = useApi(id ? `/requests/${id}` : null);
  if (!id && fromOrders) return <OrdersPrefill key={fromOrders} raw={fromOrders}>{(seed) => <Wizard seed={seed} />}</OrdersPrefill>;
  if (!id) return <Wizard />;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  if (data.request.status !== "draft") return <Notice tone="warn">{t("bz.draft_not_editable")} <Link href={`/business/requests/${id}`} className="font-semibold text-cyan underline">{t("bz.view_request")}</Link></Notice>;
  return <DraftManifest key={id} draft={data.request} hasManifest={!!data.manifest} />;
}

/**
 * A saved draft reloads its manifest (pages of 200) so the editor shows it; it is only sent back if the user changes it.
 * Placeholder parcels booked "details later" come back as a plain count (`blank`), the rest as editable rows. The cache key carries a per-visit nonce so an
 * earlier visit's (now outdated) copy is never what the editor starts from.
 */
function DraftManifest({ draft, hasManifest }: { draft: any; hasManifest: boolean }) {
  const [nonce] = useState(() => Date.now());
  const { data, error, mutate } = useSWR(hasManifest ? `draft-manifest:${draft.id}:${nonce}` : null, () => loadAllShipments(draft.id).then((l) => splitServerManifest(l.filter((x) => x.status !== "cancelled") as unknown as Array<Record<string, unknown>>)), { revalidateOnFocus: false });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (hasManifest && !data) return <PageLoading />;
  return <Wizard draft={draft} initial={data} />;
}

const fromDraft = (d: any): Record<string, any> => ({
  service: d.service, title: d.title ?? "", quantity: d.quantity, shipmentsPerDriver: d.shipmentsPerDriver ?? DEFAULT_PER_DRIVER, allowPartial: d.allowPartial !== false, durationDays: d.durationDays, vehicleType: d.vehicleType ?? "", temperature: d.temperature ?? "",
  pickupCity: d.pickupCity, deliveryCity: d.deliveryCity, pickupAddress: d.pickupAddress ?? "", deliveryAddress: d.deliveryAddress ?? "", recipientName: d.recipientName ?? "", recipientPhone: d.recipientPhone ?? "",
  contents: d.contents ?? "", notes: d.notes ?? "", startsLocal: d.startsAt ? isoToRiyadhLocal(d.startsAt) : "",
});

function Wizard({ draft, initial, seed }: { draft?: any; initial?: LoadedManifest; seed?: OrdersSeed }) {
  const { t, locale } = useI18n(); const router = useRouter(); const a = useAction();
  const { data: cat } = useApi("/catalog"); const b2b = b2bEnabledOf(cat); const { data: ov } = useApi("/business/overview"); // b2b (J3): off = no recipient-type choice, every parcel is an individual
  const [step, setStep] = useState(0);
  const [minLocal] = useState(todayLocal);
  const [f, setF] = useState<Record<string, any>>(() => draft ? fromDraft(draft) : { service: "", quantity: 1, shipmentsPerDriver: DEFAULT_PER_DRIVER, allowPartial: true, durationDays: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsLocal: "", ...seedForm(seed) });
  const [rows, setRows] = useState<ManifestRow[]>(initial?.rows ?? seed?.rows ?? []);
  // "Details later": the order is booked by number — `blank` parcels have no recipient yet (no rows exist for them); the rows are the ones filled in.
  const [later, setLater] = useState(initial?.later ?? false); const [blank, setBlank] = useState(initial?.blank ?? 0); const [confirmStrict, setConfirmStrict] = useState(false);
  const [dirty, setDirty] = useState(!draft); // a saved manifest is only re-sent after an edit
  const [serverErrs, setServerErrs] = useState<ServerRowErrors>({}); const [showRowErrs, setShowRowErrs] = useState(false); const [jump, setJump] = useState<{ index: number; seq: number } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [estState, setEstState] = useState<{ key: string; data?: any; err?: string } | null>(null);
  const [defaultStart] = useState(() => draft?.startsAt ?? new Date(Date.now() + 864e5).toISOString());
  const set = (k: string, v: unknown) => { setF((p) => ({ ...p, [k]: v })); setErrs((e) => ({ ...e, [k]: "" })); if (k === "deliveryCity") setDirty(true); };
  const onEdited = useCallback(() => { setDirty(true); setErrs((e) => (e.shipments ? { ...e, shipments: "" } : e)); }, []);
  const clearServerErrs = useCallback((uid: string) => setServerErrs((p) => { if (!p[uid]) return p; const { [uid]: _drop, ...rest } = p; return rest; }), []);
  const changeBlank = useCallback((v: number) => { setBlank(Math.max(0, Math.min(MAX_ROWS, Math.floor(v)))); setDirty(true); setErrs((e) => (e.shipments ? { ...e, shipments: "" } : e)); }, []);
  const changeMode = (toLater: boolean) => {
    if (!toLater && blank > 0) { setConfirmStrict(true); return; } // blank parcels cannot exist in the strict mode
    setLater(toLater); setDirty(true); setShowRowErrs(false); setServerErrs({}); setErrs((e) => (e.shipments ? { ...e, shipments: "" } : e));
  };
  const def = cat?.services?.find((s: any) => s.key === f.service);
  const isDelivery = !!def?.hasShipments;
  const needTemp = ["van", "dyna"].includes(f.vehicleType);
  const n = rows.length + (later ? blank : 0);
  const missing = later ? countMissing(rows, blank) : 0;
  const cod = useMemo(() => sumCod(rows), [rows]); // cash the drivers will collect (E17)
  const perDriver = Math.max(1, Math.floor(Number(f.shipmentsPerDriver) || 0));
  const drivers = Math.max(1, Math.ceil(n / perDriver)); // the server derives the same (balanced) number
  const body = useMemo(() => ({
    service: f.service, title: f.title?.trim() || null, quantity: isDelivery ? Math.max(1, Math.ceil(n / perDriver)) : Number(f.quantity), shipmentsPerDriver: isDelivery ? perDriver : null, vehicleType: f.vehicleType || null,
    temperature: needTemp ? f.temperature || null : null, pickupCity: f.pickupCity, deliveryCity: f.deliveryCity, pickupAddress: f.pickupAddress || null,
    deliveryAddress: isDelivery ? null : f.deliveryAddress || null, recipientName: isDelivery ? null : f.recipientName || null, recipientPhone: isDelivery ? null : f.recipientPhone || null, contents: isDelivery ? null : f.contents || null,
    durationDays: Number(f.durationDays), startsAt: f.startsLocal ? riyadhLocalToIso(f.startsLocal) : defaultStart, notes: f.notes || null,
    ...(isDelivery ? { allowPartial: !!f.allowPartial } : {}),
  }), [f, isDelivery, needTemp, defaultStart, n, perDriver]);

  // Live price: tells the user immediately if a route has no approved price. State is keyed by the request it answers,
  // so stale answers are ignored and no setState is needed outside the async callback. Delivery sends only the parcel COUNT.
  const ready = !!(f.service && f.vehicleType && (!needTemp || f.temperature) && (isDelivery ? n >= 1 && n <= MAX_ROWS && Number(f.shipmentsPerDriver) >= 1 : f.quantity >= 1));
  const bodyKey = JSON.stringify(isDelivery ? { ...body, shipmentCount: n, ...(later ? { detailsLater: true } : {}) } : body);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      api("POST", "/requests/estimate", JSON.parse(bodyKey)).then((data) => setEstState({ key: bodyKey, data })).catch((e) => setEstState({ key: bodyKey, err: errText(e, t) }));
    }, 350);
    return () => clearTimeout(id);
  }, [ready, bodyKey, t]);
  const cur = ready && estState?.key === bodyKey ? estState : null;
  const est = cur?.data ?? null; const estErr = cur?.err ?? null; const estBusy = !!ready && !cur;

  const quote = est?.available ? est.quote : null;
  const stepKeys: readonly string[] = isDelivery ? ["service", "route", "shipments", "review"] : ["service", "route", "review"];
  const stepKey = stepKeys[Math.min(step, stepKeys.length - 1)];
  const last = stepKeys.length - 1;
  const shipStep = isDelivery ? stepKeys.indexOf("shipments") : -1;

  function validate(s: string) {
    const e: Record<string, string> = {};
    if (s === "service") {
      if (!f.service) e.service = t("val.required");
      if (!f.vehicleType) e.vehicleType = t("val.required");
      if (needTemp && !f.temperature) e.temperature = t("val.required");
      if (!isDelivery && !(f.quantity >= 1)) e.quantity = t("val.positive");
      if (est && !est.available && !isDelivery) e.service = t("err.NO_APPROVED_PRICE");
    }
    if (s === "route") {
      if (!f.startsLocal) e.startsLocal = t("val.required"); else if (new Date(riyadhLocalToIso(f.startsLocal)) < new Date()) e.startsLocal = t("val.future");
      if (!isDelivery && !f.deliveryAddress?.trim()) e.deliveryAddress = t("val.required");
      if (!f.pickupAddress?.trim()) e.pickupAddress = t("val.required");
    }
    if (s === "shipments") {
      if (!(Number(f.shipmentsPerDriver) >= 1)) e.shipmentsPerDriver = t("val.positive");
      if (n === 0) e.shipments = t("err.MANIFEST_REQUIRED");
      else if (n > MAX_ROWS) e.shipments = t("bs.max_rows", { n: fmtNum(MAX_ROWS, locale) });
      else {
        const dup = duplicateRefs(rows);
        const badIdx = rows.findIndex((r, i) => Object.keys(validateRow(r, { partial: later })).length > 0 || dup.has(i));
        if (badIdx >= 0) { setShowRowErrs(true); setJump({ index: badIdx, seq: Date.now() }); e.shipments = t("bs.fix_rows"); }
      }
      if (!e.shipments && est && !est.available) e.shipments = t("err.NO_APPROVED_PRICE");
    }
    setErrs(e); return Object.keys(e).length === 0;
  }
  const next = () => validate(stepKey) && setStep(step + 1);

  // By count, the server pads `shipments` with blank placeholders up to `shipmentCount` (`shipments: []` + 40 books 40 blank parcels).
  const payload = () => ({ ...body, ...(isDelivery && (!draftId || dirty) ? { shipments: rows.map((r) => toWire(r, b2b)), ...(later ? { detailsLater: true, shipmentCount: n } : {}) } : {}) });
  const publish = () => a.run("pub", async () => {
    if (draftId) { await patch(`/requests/${draftId}`, payload()); setDirty(false); return post(`/requests/${draftId}/publish`, { termsAccepted: terms }); }
    return post("/requests", { ...payload(), publish: true, termsAccepted: terms });
  }, {
    success: "wizard.published", onDone: (r) => router.push(`/business/requests/${r.id}`),
    onError: (e) => {
      if (e instanceof ApiError && e.details.draftId) { setDraftId(e.details.draftId as string); setDirty(false); } // the draft (with its manifest) exists now: retry PATCHes it
      const fe = fieldErrors(e);
      if (e instanceof ApiError && e.code === "WAREHOUSE_LOCATION_REQUIRED") fe.warehouse = "1"; // shown with a link to the Profile page on the review step
      for (const k of Object.keys(fe)) if (k.startsWith("shipments") || k === "row" || k === "field") delete fe[k];
      for (const k of ["pickupAddress", "deliveryAddress"]) if (fe[k]) fe[k] = t("val.required");
      if (fe.startsAt) fe.startsLocal = fe.startsAt;
      // Per-parcel problems → the offending rows; a missing manifest → the Shipments step.
      const rowErrs = e instanceof ApiError ? mapServerRowErrors(e.details) : new Map();
      const manifestProblem = rowErrs.size > 0 || (e instanceof ApiError && (e.code === "MANIFEST_REQUIRED" || e.details.field === "shipments" || "shipments" in e.details));
      if (rowErrs.size) {
        const byUid: ServerRowErrors = {}; let first = Infinity;
        rowErrs.forEach((v, i) => { const r = rows[i]; if (r) { byUid[r.uid] = v; first = Math.min(first, i); } });
        setServerErrs(byUid); setShowRowErrs(true);
        if (first !== Infinity) setJump({ index: first, seq: Date.now() });
        fe.shipments = t("bs.fix_rows");
      } else if (manifestProblem) fe.shipments = errText(e, t);
      setErrs(fe);
      if (manifestProblem && shipStep >= 0) setStep(shipStep);
      else if (["pickupAddress", "deliveryAddress", "startsLocal"].some((k) => fe[k])) setStep(1); // those fields live on the route step
    },
  });
  const saveDraft = () => a.run("draft", async () => { const r = draftId ? await patch(`/requests/${draftId}`, payload()) : await post("/requests", payload()); setDirty(false); return r; }, { success: "common.saved", onDone: (r) => router.push(`/business/requests/${r.id}`) });

  if (!cat) return <Spinner />;
  const cities = (k: "pickup" | "delivery") => cat.cities.filter((c: any) => c[k]).map((c: any) => ({ value: c.key, label: c[locale] }));
  const steps = stepKeys.map((k) => t(k === "service" ? "wizard.step_service" : k === "route" ? "wizard.step_route" : k === "shipments" ? "bs.step_shipments" : "wizard.step_review"));
  const blocked = !!ov?.requireVerification && ov.verificationStatus !== "verified";
  const perEach = Math.ceil(n / drivers);

  return (
    <>
      <PageHeader title={t("nav.new_request")} subtitle={isDelivery ? t("bs.wizard_sub") : t("wizard.sub")} breadcrumbs={[{ label: t("nav.requests"), href: "/business/requests" }, { label: draft ? t("rdz.wiz_edit_draft", { ref: draft.ref }) : t("nav.new_request") }]} />
      {draft && <div className="mb-5"><Notice tone="info">{t("bz.editing_draft", { ref: draft.ref })}</Notice></div>}
      {seed && <div className="mb-5"><OrdersPrefillNotice seed={seed} /></div>}
      {blocked && <div className="mb-5"><Notice tone="warn" title={t("verify.pending_title")}>{t("verify.pending_body")} <Link href="/business/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      <Stepper steps={steps} current={step} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {stepKey === "service" && (
            <>
              <fieldset><legend className="mb-2 text-sm font-semibold">{t("wizard.choose_service")}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {cat.services.map((s: any) => { const I = SVC_ICON[s.key as keyof typeof SVC_ICON]; const on = f.service === s.key; return (
                    <button key={s.key} type="button" aria-pressed={on} onClick={() => { set("service", s.key); if (s.key !== "delivery_driver") set("shipmentsPerDriver", null); else if (!f.shipmentsPerDriver) set("shipmentsPerDriver", DEFAULT_PER_DRIVER); }} className={cn("rounded-card border p-4 text-start transition", on ? "border-accent bg-accent/10" : "border-line bg-card hover:border-accent/50")}>
                      <I className={cn("mb-3 size-7", on ? "text-accent" : "text-muted")} aria-hidden /><p className="font-semibold">{t(`svc.${s.key}`)}</p><p className="mt-1 text-xs text-muted">{t(`svc.${s.key}_desc`)}</p>
                    </button>); })}
                </div>
                {errs.service && <p role="alert" className="mt-2 text-xs text-danger">{errs.service}</p>}
              </fieldset>
              <Card className="grid gap-4 sm:grid-cols-2">
                <Select label={t("wizard.vehicle")} placeholder={t("common.select")} options={cat.vehicleTypes.map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value)} error={errs.vehicleType} required />
                {needTemp && <Select label={t("reg.temperature")} placeholder={t("common.select")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.temperature ?? ""} onChange={(e) => set("temperature", e.target.value)} error={errs.temperature} required />}
                {!isDelivery && <Input label={def?.driverless ? t("wizard.vehicles_count") : t("wizard.drivers_count")} type="number" min={1} max={500} value={f.quantity} onChange={(e) => set("quantity", Number(e.target.value))} error={errs.quantity} required />}
                {def && !def.hasShipments && <Input label={t("wizard.days")} type="number" min={1} max={90} value={f.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} hint={t("wizard.days_hint")} />}
                {isDelivery && <div className="sm:col-span-2"><Notice tone="info">{t("bs.drivers_derived_note")}</Notice></div>}
              </Card>
            </>
          )}
          {stepKey === "route" && (
            <Card className="grid gap-4 sm:grid-cols-2">
              <Select label={t("wizard.pickup_city")} options={cities("pickup")} value={f.pickupCity} onChange={(e) => set("pickupCity", e.target.value)} hint={t("wizard.pickup_hint")} />
              <Select label={t("wizard.delivery_city")} options={cities("delivery")} value={f.deliveryCity} onChange={(e) => set("deliveryCity", e.target.value)} hint={isDelivery ? t("bs.one_city_hint") : undefined} />
              <div className="sm:col-span-2"><Input label={t("bz.title_label")} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={120} /></div>
              <Input label={t("wizard.pickup_address")} value={f.pickupAddress ?? ""} onChange={(e) => set("pickupAddress", e.target.value)} error={errs.pickupAddress} required />
              {!isDelivery && <Input label={t("wizard.delivery_address")} value={f.deliveryAddress ?? ""} onChange={(e) => set("deliveryAddress", e.target.value)} error={errs.deliveryAddress} required />}
              <Input label={t("wizard.starts")} type="datetime-local" ltr min={minLocal} value={f.startsLocal} onChange={(e) => set("startsLocal", e.target.value)} error={errs.startsLocal} hint={t("wizard.starts_hint")} required />
              {isDelivery && <Input label={t("wizard.days")} type="number" min={1} max={90} value={f.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} />}
              {def && !def.driverless && <div className="sm:col-span-2"><WarehouseLocationNotice newTab /></div>}
              {isDelivery && <div className="sm:col-span-2"><Notice tone="info">{t("bs.stops_next_note")}</Notice></div>}
              <div className="sm:col-span-2"><Textarea label={t("wizard.notes")} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={500} /></div>
            </Card>
          )}
          {stepKey === "shipments" && (
            <>
              <DetailsModeSwitch later={later} onChange={changeMode} />
              <Card className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("bs.parcels_count")}</p><p className="text-2xl font-bold tabular-nums text-accent" data-testid="parcel-count">{fmtNum(n, locale)}</p></div>
                  <Input label={t("bs.per_driver")} type="number" min={1} max={1000} value={f.shipmentsPerDriver ?? ""} onChange={(e) => set("shipmentsPerDriver", Number(e.target.value))} error={errs.shipmentsPerDriver} hint={t("bs.per_driver_hint")} required />
                  <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("bs.drivers_needed")}</p><p className="text-2xl font-bold tabular-nums" data-testid="driver-count">{n > 0 ? fmtNum(drivers, locale) : "—"}</p>{n > 0 && <p className="text-xs text-muted">{t("bs.about_each", { n: fmtNum(perEach, locale) })}</p>}</div>
                </div>
                <Checkbox checked={!f.allowPartial} onChange={(e) => set("allowPartial", !e.target.checked)} label={<><span className="font-medium text-ink">{t("bs.all_or_nothing")}</span><span className="mt-0.5 block text-xs">{t("bs.all_or_nothing_hint")}</span></>} />
              </Card>
              {errs.shipments && <Notice tone="danger">{errs.shipments}</Notice>}
              <ManifestEditor rows={rows} setRows={setRows} onEdited={onEdited} cityLabel={t(`city.${f.deliveryCity}`)} showErrors={showRowErrs} serverErrs={serverErrs} clearServerErrs={clearServerErrs} jumpTo={jump}
                later={later} blank={blank} onBlank={changeBlank} demoMode={!!cat.demoMode} deliveryCity={f.deliveryCity} />
            </>
          )}
          {stepKey === "review" && (
            <>
              <Section title={t("wizard.summary")}><dl className="divide-y divide-line">
                <KV label={t("req.service")}>{t(`svc.${f.service}`)}</KV><KV label={t("wizard.vehicle")}>{t(`vehicle.${f.vehicleType}`)}{f.temperature && needTemp ? ` · ${t(`temp.${f.temperature}`)}` : ""}</KV>
                {isDelivery ? <>
                  <KV label={t("bs.parcels_count")}>{fmtNum(n, locale)}</KV><KV label={t("bs.per_driver")}>{fmtNum(perDriver, locale)}</KV><KV label={t("bs.drivers_needed")}>{fmtNum(drivers, locale)}</KV>
                  <KV label={t("bs.start_rule")}>{f.allowPartial ? t("bs.start_partial") : t("bs.start_all")}</KV>
                  {cod.parcels > 0 && <KV label={t("fob.cod_total")}><span className="ltr-num font-bold text-gold" data-testid="review-cod-total">{fmtMoney(cod.totalCents, locale)}</span> <span className="text-xs font-normal text-muted">({t("fob.cod_parcels", { n: fmtNum(cod.parcels, locale) })})</span></KV>}
                </> : <KV label={def?.driverless ? t("wizard.vehicles_count") : t("wizard.drivers_count")}>{fmtNum(f.quantity, locale)}</KV>}
                <KV label={t("req.route")}>{t(`city.${f.pickupCity}`)} <ArrowRight className="mx-0.5 inline size-3.5 rtl:rotate-180" aria-hidden /> {t(`city.${f.deliveryCity}`)}</KV><KV label={t("wizard.starts")}><span className="ltr-num">{f.startsLocal?.replace("T", " ")}</span></KV>
                <KV label={t("wizard.days")}>{fmtNum(f.durationDays, locale)}</KV></dl></Section>
              {isDelivery && cod.parcels > 0 && <Notice tone="info"><span data-testid="review-cod-note">{t("fob.cod_review", { amount: fmtMoney(cod.totalCents, locale) })}</span> {t("fob.cod_review_hint")}</Notice>}
              {isDelivery && missing > 0 && <Notice tone="warn" title={t("pb.review_missing_title", { n: fmtNum(missing, locale) })}><span data-testid="review-missing-warning">{t("pb.review_missing_body")}</span></Notice>}
              {isDelivery && (
                <Section title={t("bs.step_shipments")} actions={<button type="button" className="text-sm text-cyan hover:underline" onClick={() => setStep(shipStep)}>{t("common.edit")}</button>}><div className="space-y-2">
                  <ul className="divide-y divide-line text-sm">
                    {rows.slice(0, 5).map((r, i) => <li key={r.uid} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 truncate"><span className="me-2 tabular-nums text-muted">{fmtNum(i + 1, locale)}</span>{r.recipientName || <span className="text-gold">{t("pb.review_row_blank")}</span>} · <span className="text-muted">{r.address || "—"}</span></span><span className="flex items-center gap-2 text-xs text-muted">{sumCod([r]).totalCents > 0 && <span className="ltr-num font-medium text-gold">{fmtMoney(sumCod([r]).totalCents, locale)}</span>}{b2b && t(`rtype.${r.recipientType}`)}</span></li>)}
                    {later && blank > 0 && <li className="py-2 text-gold" data-testid="review-blank-line">{t("pb.blank_summary", { n: fmtNum(blank, locale) })}</li>}
                  </ul>
                  {rows.length > 5 && <p className="text-xs text-muted">{t("bs.and_more", { n: fmtNum(rows.length - 5, locale) })}</p>}
                </div></Section>
              )}
              <Section title={t("wizard.obligations")}><div className="space-y-3">
                <ul className="list-disc space-y-1 ps-5 text-sm text-muted"><li>{t("wizard.ob1")}</li><li>{isDelivery ? t("bs.ob2") : t("wizard.ob2")}</li><li>{t("wizard.ob3")}</li></ul>
                <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={<>{t("wizard.accept_terms")} <span className="text-xs text-muted">v{cat.terms.version}</span></>} />
              </div></Section>
              {errs.form && <Notice tone="danger">{errs.form}</Notice>}
              {errs.warehouse && <WarehouseLocationNotice always tone="danger" newTab />}
              {errs.shipments && <Notice tone="danger">{errs.shipments}</Notice>}
              {quote && est && !est.sufficientFunds && <Notice tone="warn" title={t("err.INSUFFICIENT_FUNDS")}>{t("wizard.need_funds", { amount: fmtMoney(quote.totalCents - est.wallet.availableCents, locale) })} <Link href="/business/wallet" className="font-semibold text-cyan underline">{t("wallet.topup")}</Link></Notice>}
            </>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("common.back")}</Button>
            <div className="flex gap-2">
              {step === last && <Button variant="secondary" loading={a.is("draft")} onClick={saveDraft}>{t("wizard.save_draft")}</Button>}
              {step < last ? <Button onClick={next}>{t("common.next")}</Button> : <Button loading={a.is("pub")} disabled={!terms || !quote || blocked || (est && !est.sufficientFunds)} onClick={publish}>{t("wizard.publish")}</Button>}
            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div aria-live="polite"><Section title={<span className="flex items-center gap-2"><Info className="size-4 text-cyan" aria-hidden />{t("wizard.estimate")}</span>}><div className="space-y-3">
            {!ready ? <p className="text-sm text-muted">{isDelivery && n === 0 ? t("bs.estimate_wait_parcels") : t("wizard.estimate_wait")}</p> : estBusy ? <Spinner /> : estErr ? <p className="text-sm text-danger">{estErr}</p> : est && !est.available ? (
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm"><p className="flex items-center gap-2 font-semibold text-danger"><AlertCircle className="size-4" />{t("wizard.no_price_title")}</p><p className="mt-1 text-muted">{t("wizard.no_price_body")}</p></div>
            ) : quote ? (
              <>
                <dl className="divide-y divide-line text-sm">
                  <KV label={t("wizard.unit_price")}><span className="ltr-num">{fmtMoney(quote.unitPriceCents, locale)}</span> <span className="text-xs text-muted">/ {t(`unit.${quote.unit}`)}</span></KV>
                  {isDelivery
                    ? <><KV label={t("bs.parcels_count")}><span className="tabular-nums">{fmtNum(quote.totalUnits ?? n, locale)}</span></KV><KV label={t("bs.drivers_needed")}><span className="tabular-nums">{fmtNum(quote.quantity, locale)}</span></KV></>
                    : <KV label={t("wizard.units")}>{fmtNum(quote.quantity, locale)} × {fmtNum(quote.expectedUnits, locale)}</KV>}
                </dl>
                <div className="rounded-xl bg-accent/10 p-3"><p className="text-xs text-muted">{t("wizard.total_reserved")}</p><p className="ltr-num text-2xl font-extrabold text-accent">{fmtMoney(quote.totalCents, locale)}</p>{isDelivery && <p className="mt-0.5 text-xs text-muted"><span className="tabular-nums">{fmtNum(quote.totalUnits ?? n, locale)}</span> × <span className="ltr-num">{fmtMoney(quote.unitPriceCents, locale)}</span></p>}</div>
                <p className="flex items-start gap-2 text-xs text-muted"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" />{isDelivery ? t("bs.refund_note") : t("wizard.refund_note")}</p>
                <div className="flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-xs"><span className="text-muted">{t("wallet.available")}</span><span className={cn("ltr-num font-semibold", est.sufficientFunds ? "text-accent" : "text-gold")}>{fmtMoney(est.wallet.availableCents, locale)}</span></div>
              </>
            ) : null}
          </div></Section></div>
        </aside>
      </div>
      <Modal open={confirmStrict} onClose={() => setConfirmStrict(false)} title={t("pb.mode_switch_title")} footer={<><Button variant="ghost" onClick={() => setConfirmStrict(false)}>{t("common.cancel")}</Button><Button variant="danger" data-testid="mode-switch-confirm" onClick={() => { setBlank(0); setLater(false); setDirty(true); setShowRowErrs(false); setServerErrs({}); setConfirmStrict(false); }}>{t("pb.mode_switch_confirm")}</Button></>}>
        <Notice tone="warn">{t("pb.mode_switch_note", { n: fmtNum(blank, locale) })}</Notice>
      </Modal>
    </>
  );
}
