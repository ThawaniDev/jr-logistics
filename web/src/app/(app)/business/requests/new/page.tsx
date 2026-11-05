"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bike, Car, CarFront, Info, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Card, Checkbox, Input, Notice, PageHeader, Select, Stepper, Textarea, KV, errText, fieldErrors, useAction, Spinner } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { api, post, patch, ApiError } from "@/lib/api";
import { fmtMoney, fmtNum, riyadhLocalToIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

const SVC_ICON = { delivery_driver: Bike, car_with_driver: CarFront, car_without_driver: Car } as const;
const todayLocal = () => { const d = new Date(Date.now() + 3 * 3600_000 + 3600_000); return d.toISOString().slice(0, 16); };

export default function NewRequestPage() {
  const { t, locale } = useI18n(); const router = useRouter(); const a = useAction();
  const { data: cat } = useApi("/catalog"); const { data: offices } = useApi("/business/offices"); const { data: ov } = useApi("/business/overview");
  const [step, setStep] = useState(0);
  const [minLocal] = useState(todayLocal);
  const [f, setF] = useState<Record<string, any>>({ service: "", quantity: 1, shipmentsPerDriver: 20, durationDays: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsLocal: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [estState, setEstState] = useState<{ key: string; data?: any; err?: string } | null>(null);
  const [defaultStart] = useState(() => new Date(Date.now() + 864e5).toISOString());
  const set = (k: string, v: unknown) => { setF((p) => ({ ...p, [k]: v })); setErrs((e) => ({ ...e, [k]: "" })); };
  const def = cat?.services?.find((s: any) => s.key === f.service);
  const needTemp = ["van", "dyna"].includes(f.vehicleType);
  const body = useMemo(() => ({
    service: f.service, quantity: Number(f.quantity), shipmentsPerDriver: def?.hasShipments ? Number(f.shipmentsPerDriver) : null, vehicleType: f.vehicleType || null,
    temperature: needTemp ? f.temperature || null : null, pickupCity: f.pickupCity, deliveryCity: f.deliveryCity, pickupAddress: f.pickupAddress || null, deliveryAddress: f.deliveryAddress || null,
    recipientName: f.recipientName || null, recipientPhone: f.recipientPhone || null, contents: f.contents || null, durationDays: Number(f.durationDays),
    startsAt: f.startsLocal ? riyadhLocalToIso(f.startsLocal) : defaultStart, notes: f.notes || null, preferredOfficeId: f.preferredOfficeId || null,
  }), [f, def, needTemp, defaultStart]);

  // Live price: tells the user immediately if a route has no approved price. State is keyed by the request it answers,
  // so stale answers are ignored and no setState is needed outside the async callback.
  const ready = f.service && f.vehicleType && (!needTemp || f.temperature) && f.quantity >= 1 && (!def?.hasShipments || f.shipmentsPerDriver >= 1);
  const bodyKey = JSON.stringify(body);
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
  function validate(s: number) {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!f.service) e.service = t("val.required");
      if (!f.vehicleType) e.vehicleType = t("val.required");
      if (needTemp && !f.temperature) e.temperature = t("val.required");
      if (!(f.quantity >= 1)) e.quantity = t("val.positive");
      if (def?.hasShipments && !(f.shipmentsPerDriver >= 1)) e.shipmentsPerDriver = t("val.positive");
      if (est && !est.available) e.service = t("err.NO_APPROVED_PRICE");
    }
    if (s === 1) {
      if (!f.startsLocal) e.startsLocal = t("val.required"); else if (new Date(riyadhLocalToIso(f.startsLocal)) < new Date()) e.startsLocal = t("val.future");
      if (!f.deliveryAddress?.trim()) e.deliveryAddress = t("val.required");
      if (!f.pickupAddress?.trim()) e.pickupAddress = t("val.required");
      if (def?.hasShipments && f.recipientPhone && !/^\+?\d{8,15}$|^0?5\d{8}$/.test(f.recipientPhone.replace(/\s/g, ""))) e.recipientPhone = t("val.phone");
    }
    setErrs(e); return Object.keys(e).length === 0;
  }
  const next = () => validate(step) && setStep(step + 1);

  const publish = () => a.run("pub", async () => {
    if (draftId) { await patch(`/requests/${draftId}`, body); return post(`/requests/${draftId}/publish`, { termsAccepted: terms }); }
    return post("/requests", { ...body, publish: true, termsAccepted: terms });
  }, {
    success: "wizard.published", onDone: (r) => router.push(`/business/requests/${r.id}`),
    onError: (e) => { if (e instanceof ApiError && e.details.draftId) setDraftId(e.details.draftId as string); setErrs({ ...fieldErrors(e) }); },
  });
  const saveDraft = () => a.run("draft", async () => draftId ? patch(`/requests/${draftId}`, body) : post("/requests", body), { success: "common.saved", onDone: (r) => router.push(`/business/requests/${r.id}`) });

  if (!cat) return <Spinner />;
  const cities = (k: "pickup" | "delivery") => cat.cities.filter((c: any) => c[k]).map((c: any) => ({ value: c.key, label: c[locale] }));
  const steps = [t("wizard.step_service"), t("wizard.step_route"), t("wizard.step_review")];
  const blocked = ov && ov.verificationStatus !== "verified";

  return (
    <>
      <PageHeader title={t("nav.new_request")} subtitle={t("wizard.sub")} />
      {blocked && <div className="mb-5"><Notice tone="warn" title={t("verify.pending_title")}>{t("verify.pending_body")} <Link href="/business/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      <Stepper steps={steps} current={step} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {step === 0 && (
            <>
              <fieldset><legend className="mb-2 text-sm font-semibold">{t("wizard.choose_service")}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {cat.services.map((s: any) => { const I = SVC_ICON[s.key as keyof typeof SVC_ICON]; const on = f.service === s.key; return (
                    <button key={s.key} type="button" aria-pressed={on} onClick={() => { set("service", s.key); if (s.key !== "delivery_driver") set("shipmentsPerDriver", null); else if (!f.shipmentsPerDriver) set("shipmentsPerDriver", 20); }} className={cn("rounded-card border p-4 text-start transition", on ? "border-accent bg-accent/10" : "border-line bg-card hover:border-accent/50")}>
                      <I className={cn("mb-3 size-7", on ? "text-accent" : "text-muted")} aria-hidden /><p className="font-semibold">{t(`svc.${s.key}`)}</p><p className="mt-1 text-xs text-muted">{t(`svc.${s.key}_desc`)}</p>
                    </button>); })}
                </div>
                {errs.service && <p role="alert" className="mt-2 text-xs text-danger">{errs.service}</p>}
              </fieldset>
              <Card className="grid gap-4 sm:grid-cols-2">
                <Select label={t("wizard.vehicle")} placeholder={t("common.select")} options={cat.vehicleTypes.map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value)} error={errs.vehicleType} required />
                {needTemp && <Select label={t("reg.temperature")} placeholder={t("common.select")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.temperature ?? ""} onChange={(e) => set("temperature", e.target.value)} error={errs.temperature} required />}
                <Input label={def?.driverless ? t("wizard.vehicles_count") : t("wizard.drivers_count")} type="number" min={1} max={500} value={f.quantity} onChange={(e) => set("quantity", Number(e.target.value))} error={errs.quantity} required />
                {def?.hasShipments && <Input label={t("wizard.shipments_per_driver")} type="number" min={1} value={f.shipmentsPerDriver ?? ""} onChange={(e) => set("shipmentsPerDriver", Number(e.target.value))} error={errs.shipmentsPerDriver} hint={t("wizard.shipments_hint")} required />}
                {def && !def.hasShipments && <Input label={t("wizard.days")} type="number" min={1} max={90} value={f.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} hint={t("wizard.days_hint")} />}
              </Card>
            </>
          )}
          {step === 1 && (
            <Card className="grid gap-4 sm:grid-cols-2">
              <Select label={t("wizard.pickup_city")} options={cities("pickup")} value={f.pickupCity} onChange={(e) => set("pickupCity", e.target.value)} hint={t("wizard.pickup_hint")} />
              <Select label={t("wizard.delivery_city")} options={cities("delivery")} value={f.deliveryCity} onChange={(e) => set("deliveryCity", e.target.value)} />
              <Input label={t("wizard.pickup_address")} value={f.pickupAddress ?? ""} onChange={(e) => set("pickupAddress", e.target.value)} error={errs.pickupAddress} required />
              <Input label={t("wizard.delivery_address")} value={f.deliveryAddress ?? ""} onChange={(e) => set("deliveryAddress", e.target.value)} error={errs.deliveryAddress} required />
              <Input label={t("wizard.starts")} type="datetime-local" ltr min={minLocal} value={f.startsLocal} onChange={(e) => set("startsLocal", e.target.value)} error={errs.startsLocal} hint={t("wizard.starts_hint")} required />
              {def?.hasShipments && <Input label={t("wizard.days")} type="number" min={1} max={90} value={f.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} />}
              {def?.hasShipments && <><Input label={t("wizard.recipient_name")} value={f.recipientName ?? ""} onChange={(e) => set("recipientName", e.target.value)} /><Input label={t("wizard.recipient_phone")} type="tel" ltr value={f.recipientPhone ?? ""} onChange={(e) => set("recipientPhone", e.target.value)} error={errs.recipientPhone} hint={t("wizard.recipient_hint")} /><Input label={t("wizard.contents")} value={f.contents ?? ""} onChange={(e) => set("contents", e.target.value)} /></>}
              {(offices?.items?.length ?? 0) > 0 && !def?.driverless && <Select label={t("wizard.preferred_office")} placeholder={t("wizard.any_office")} options={offices.items.map((o: any) => ({ value: o.id, label: o.name }))} value={f.preferredOfficeId ?? ""} onChange={(e) => set("preferredOfficeId", e.target.value)} hint={t("wizard.office_hint")} />}
              <div className="sm:col-span-2"><Textarea label={t("wizard.notes")} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={500} /></div>
            </Card>
          )}
          {step === 2 && (
            <>
              <Card><h3 className="mb-2 font-semibold">{t("wizard.summary")}</h3><dl className="divide-y divide-line">
                <KV label={t("req.service")}>{t(`svc.${f.service}`)}</KV><KV label={t("wizard.vehicle")}>{t(`vehicle.${f.vehicleType}`)}{f.temperature && needTemp ? ` · ${t(`temp.${f.temperature}`)}` : ""}</KV>
                <KV label={def?.driverless ? t("wizard.vehicles_count") : t("wizard.drivers_count")}>{fmtNum(f.quantity, locale)}</KV>
                {def?.hasShipments && <KV label={t("wizard.shipments_per_driver")}>{fmtNum(f.shipmentsPerDriver, locale)}</KV>}
                <KV label={t("req.route")}>{t(`city.${f.pickupCity}`)} → {t(`city.${f.deliveryCity}`)}</KV><KV label={t("wizard.starts")}><span className="ltr-num">{f.startsLocal?.replace("T", " ")}</span></KV>
                <KV label={t("wizard.days")}>{fmtNum(f.durationDays, locale)}</KV></dl></Card>
              <Card className="space-y-3"><h3 className="font-semibold">{t("wizard.obligations")}</h3>
                <ul className="list-disc space-y-1 ps-5 text-sm text-muted"><li>{t("wizard.ob1")}</li><li>{t("wizard.ob2")}</li><li>{t("wizard.ob3")}</li></ul>
                <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={<>{t("wizard.accept_terms")} <span className="text-xs text-muted">v{cat.terms.version}</span></>} />
              </Card>
              {errs.form && <Notice tone="danger">{errs.form}</Notice>}
              {quote && est && !est.sufficientFunds && <Notice tone="warn" title={t("err.INSUFFICIENT_FUNDS")}>{t("wizard.need_funds", { amount: fmtMoney(quote.totalCents - est.wallet.availableCents, locale) })} <Link href="/business/wallet" className="font-semibold text-cyan underline">{t("wallet.topup")}</Link></Notice>}
            </>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>{t("common.back")}</Button>
            <div className="flex gap-2">
              {step === 2 && <Button variant="secondary" loading={a.is("draft")} onClick={saveDraft}>{t("wizard.save_draft")}</Button>}
              {step < 2 ? <Button onClick={next}>{t("common.next")}</Button> : <Button loading={a.is("pub")} disabled={!terms || !quote || blocked || (est && !est.sufficientFunds)} onClick={publish}>{t("wizard.publish")}</Button>}
            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-3" aria-live="polite">
            <h3 className="flex items-center gap-2 font-semibold"><Info className="size-4 text-cyan" aria-hidden />{t("wizard.estimate")}</h3>
            {!ready ? <p className="text-sm text-muted">{t("wizard.estimate_wait")}</p> : estBusy ? <Spinner /> : estErr ? <p className="text-sm text-danger">{estErr}</p> : est && !est.available ? (
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm"><p className="flex items-center gap-2 font-semibold text-danger"><AlertCircle className="size-4" />{t("wizard.no_price_title")}</p><p className="mt-1 text-muted">{t("wizard.no_price_body")}</p></div>
            ) : quote ? (
              <>
                <dl className="divide-y divide-line text-sm">
                  <KV label={t("wizard.unit_price")}><span className="ltr-num">{fmtMoney(quote.unitPriceCents, locale)}</span> <span className="text-xs text-muted">/ {t(`unit.${quote.unit}`)}</span></KV>
                  <KV label={t("wizard.units")}>{fmtNum(quote.quantity, locale)} × {fmtNum(quote.expectedUnits, locale)}</KV>
                </dl>
                <div className="rounded-xl bg-accent/10 p-3"><p className="text-xs text-muted">{t("wizard.total_reserved")}</p><p className="ltr-num text-2xl font-extrabold text-accent">{fmtMoney(quote.totalCents, locale)}</p></div>
                <p className="flex items-start gap-2 text-xs text-muted"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" />{t("wizard.refund_note")}</p>
                <div className="flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-xs"><span className="text-muted">{t("wallet.available")}</span><span className={cn("ltr-num font-semibold", est.sufficientFunds ? "text-accent" : "text-gold")}>{fmtMoney(est.wallet.availableCents, locale)}</span></div>
              </>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}
