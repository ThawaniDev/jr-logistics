"use client";
import { useState } from "react";
import Link from "next/link";
import { Bike, CarFront, Car, Calculator, ShieldCheck, ArrowRight, Minus, Plus, MapPin } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useApi } from "@/components/ui/data";
import { fmtMoney, fmtNum } from "@/lib/format";
import { DEFAULT_PER_DRIVER } from "@/components/features/business-shipments-lib";
import { cn } from "@/lib/cn";

type ServiceType = "delivery_driver" | "car_with_driver" | "car_without_driver";

const SERVICES: Array<{ key: ServiceType; icon: typeof Bike }> = [
  { key: "delivery_driver", icon: Bike },
  { key: "car_with_driver", icon: CarFront },
  { key: "car_without_driver", icon: Car },
];

type Rule = { service: string; vehicleType: string | null; pickupCity: string | null; deliveryCity: string | null; priceCents: number };
type CatalogCity = { key: string; ar: string; en: string; ur: string; pickup: boolean };

export function CostCalculator() {
  const { t, locale } = useI18n();
  const [service, setService] = useState<ServiceType>("delivery_driver");
  const [count, setCount] = useState<number>(3);
  const [units, setUnits] = useState<number>(50); // delivery: parcels (price = parcels × unit price); cars: days
  const [city, setCity] = useState<string>("riyadh");

  // Real prices only: the lowest approved platform-wide rate that applies to the chosen service and pickup city.
  // No rule → no number (a quote request is the honest answer), never an invented figure.
  const { data: pricing } = useApi<{ items: Rule[] }>("/pricing/indicative");
  const { data: cat } = useApi<{ cities: CatalogCity[] }>("/catalog");
  const cities = (cat?.cities ?? []).filter((c) => c.pickup);
  const fromCents = (pricing?.items ?? []).filter((r) => r.service === service && (!r.pickupCity || r.pickupCity === city)).reduce<number | null>((m, r) => (m === null || r.priceCents < m ? r.priceCents : m), null);
  const delivery = service === "delivery_driver";
  const totalCents = fromCents === null ? null : (delivery ? units : count * units) * fromCents;
  // Delivery is priced per parcel; the number of drivers is only a consequence (parcels ÷ parcels per driver).
  const driversNeeded = Math.max(1, Math.ceil(units / DEFAULT_PER_DRIVER));
  const clampUnits = (v: number) => Math.min(delivery ? 2000 : 100, Math.max(1, Math.floor(v) || 1));

  return (
    <div id="estimate" className="relative mx-auto max-w-5xl rounded-3xl border border-line/80 bg-card/60 p-6 sm:p-10 shadow-2xl backdrop-blur-xl">
      <div className="absolute -top-12 -start-12 size-48 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -end-12 size-48 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-xs font-semibold text-accent">
          <Calculator className="size-3.5" aria-hidden />
          {t("landing.est_eyebrow")}
        </span>
        <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">
          {t("landing.est_title")}
        </h2>
        <p className="mt-2 text-sm sm:text-base text-muted max-w-xl mx-auto">
          {t("landing.est_sub")}
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12 items-center">
        {/* Controls Column */}
        <div className="space-y-6 lg:col-span-7">
          {/* Service Picker */}
          <div>
            <p id="est-service" className="mb-2 block text-xs font-semibold text-muted">
              {t("landing.est_service")}
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="group" aria-labelledby="est-service">
              {SERVICES.map(({ key, icon: I }) => {
                const active = service === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setService(key);
                      if (key === "delivery_driver") setUnits(50);
                      else setUnits(3);
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition-all",
                      active
                        ? "border-accent bg-accent/15 text-accent shadow-[0_0_20px_rgba(5,229,163,0.15)] font-bold"
                        : "border-line bg-bg2/60 text-muted hover:border-line/80 hover:text-ink"
                    )}
                  >
                    <I className="size-6" aria-hidden />
                    <span className="text-xs font-semibold">{t(`svc.${key}`)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Drivers / Fleet Count (delivery is priced per parcel, the driver count is derived) */}
            {!delivery && <div className="rounded-2xl border border-line bg-bg2/60 p-4">
              <p id="est-count" className="text-xs font-semibold text-muted block mb-2">
                {t("landing.est_count")}
              </p>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                  className="flex size-9 items-center justify-center rounded-xl border border-line bg-card text-muted hover:text-ink hover:border-accent/50 transition-colors"
                  aria-label={t("landing.est_decrease")}
                >
                  <Minus className="size-4" />
                </button>
                <span className="text-xl font-extrabold text-ink ltr-num" aria-labelledby="est-count" role="status">{count}</span>
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.min(50, c + 1))}
                  className="flex size-9 items-center justify-center rounded-xl border border-line bg-card text-muted hover:text-ink hover:border-accent/50 transition-colors"
                  aria-label={t("landing.est_increase")}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>}

            {/* Units (parcels or days) */}
            <div className={cn("rounded-2xl border border-line bg-bg2/60 p-4", delivery && "sm:col-span-2")}>
              <label htmlFor="est-units" className="text-xs font-semibold text-muted block mb-2">
                {delivery ? t("bs.est_parcels") : t("wizard.days")}
              </label>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setUnits((u) => Math.max(1, u - (delivery ? 10 : 1)))}
                  className="flex size-9 items-center justify-center rounded-xl border border-line bg-card text-muted hover:text-ink hover:border-accent/50 transition-colors"
                  aria-label={t("landing.est_decrease")}
                >
                  <Minus className="size-4" />
                </button>
                <input id="est-units" type="number" inputMode="numeric" min={1} max={delivery ? 2000 : 100} value={units} onChange={(e) => setUnits(clampUnits(Number(e.target.value)))} onFocus={(e) => e.currentTarget.select()} className="w-full min-w-0 bg-transparent text-center text-xl font-extrabold text-ink ltr-num focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                <button
                  type="button"
                  onClick={() => setUnits((u) => Math.min(delivery ? 2000 : 100, u + (delivery ? 10 : 1)))}
                  className="flex size-9 items-center justify-center rounded-xl border border-line bg-card text-muted hover:text-ink hover:border-accent/50 transition-colors"
                  aria-label={t("landing.est_increase")}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* City Selection */}
          <div>
            <label htmlFor="est-city" className="mb-2 block text-xs font-semibold text-muted">
              {t("landing.est_city")}
            </label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-cyan" aria-hidden />
              <select
                id="est-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-2xl border border-line bg-bg2/60 ps-10 pe-4 py-3 text-sm font-medium text-ink focus:border-accent focus:outline-none"
              >
                {(cities.length ? cities : [{ key: "riyadh", ar: "الرياض", en: "Riyadh", ur: "ریاض", pickup: true }]).map((c) => (
                  <option key={c.key} value={c.key} className="bg-card text-ink">
                    {c[locale as "ar" | "en" | "ur"] || c.ar}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Output Quote Column */}
        <div className="lg:col-span-5">
          <div className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-b from-card to-bg2 p-6 sm:p-8 text-center shadow-2xl">
            <div className="absolute top-0 end-0 size-32 bg-accent/15 blur-2xl pointer-events-none" />

            <p className="text-xs font-bold uppercase tracking-wider text-muted">
              {t("landing.est_total")}
            </p>

            <div className="mt-3 flex items-baseline justify-center gap-2">
              {totalCents === null ? (
                <span className="text-lg font-bold text-ink">{t("landing.est_no_price")}</span>
              ) : (
                <span className="text-4xl sm:text-5xl font-black text-gradient ltr-num">{t("landing.est_from")} {fmtMoney(totalCents, locale)}</span>
              )}
            </div>

            {totalCents !== null && fromCents !== null && <p className="mt-2 text-xs text-muted ltr-num">{delivery ? `${fmtNum(units, locale)} × ${fmtMoney(fromCents, locale)}` : `${count} × ${units} × ${fmtMoney(fromCents, locale)}`}</p>}
            {delivery && <p className="mt-1 text-xs text-muted">{t("ubz.calc_drivers", { n: driversNeeded, per: DEFAULT_PER_DRIVER })}</p>}

            <div className="mt-4 rounded-xl border border-line/60 bg-bg/60 p-3.5 text-xs text-muted flex items-start gap-2.5 text-start">
              <ShieldCheck className="size-4 text-gold shrink-0 mt-0.5" aria-hidden />
              <p>{t("landing.est_note")}</p>
            </div>

            <Link
              href="/login?role=business"
              className="mt-6 inline-flex w-full h-13 items-center justify-center gap-2 rounded-2xl bg-accent px-6 font-bold text-accent-ink hover:brightness-110 shadow-[0_0_25px_rgba(5,229,163,0.3)] transition-all"
            >
              <span>{t("landing.est_cta")}</span>
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

