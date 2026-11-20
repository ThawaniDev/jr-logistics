import { slotShape } from "@/server/shipments";
import { TEMPERATURE_VEHICLES } from "@/server/catalog";
import { DAY, HOUR, MIN, ksa, ksaDayStart, toQuarter } from "./calendar";
import { districtsOf, jitter, STREETS, STREETS_AR } from "./geo";
import { IdGen, recipientPhone, refOf } from "./ids";
import { NOTES_PARCEL, recipientName } from "./names";
import type { Rng } from "./prng";
import { clamp } from "./prng";
import type { RuleRow } from "./load";
import type { CompanySim, Ctx } from "./types";

/** What one request will be, decided before anything is simulated. */
export interface ParcelSpec {
  seq: number; code: string; externalRef: string | null; type: "consumer" | "business"; name: string; phone: string; address: string; city: string; lat: number; lng: number; district: string;
  contents: string; notes: string | null; codCents: number;
}
export interface RequestPlan {
  n: number; id: string; ref: string; company: CompanySim; service: "delivery_driver" | "car_with_driver" | "car_without_driver";
  tc: number; tp: number; startsAt: number; durationDays: number; quantity: number; perDriver: number | null;
  vehicleType: string; temperature: string | null; pickupCity: string; deliveryCity: string; rule: RuleRow;
  parcels: ParcelSpec[]; allowPartial: boolean; via: "web" | "api" | "mobile"; title: string | null; notes: string | null;
  pickupAddress: string; deliveryAddress: string | null; pickupLat: number; pickupLng: number; deliveryLat: number | null; deliveryLng: number | null;
  abandoned: boolean; lang: "en" | "ar";
}

const hourOfStart = (rng: Rng, kind: "morning" | "any") => (kind === "morning" ? rng.weighted([[7, 1], [8, 3], [9, 5], [10, 5], [11, 3], [12, 2]] as const) : rng.int(8, 19));

/** Chooses everything about one request (service, size, route, vehicle, times) — or null when no approved price exists for what the business wanted. */
export function drawPlan(ctx: Ctx, rng: Rng, n: number, company: CompanySim, tc: number): RequestPlan | null {
  const { base } = ctx;
  const cfg = base;
  const id = ctx.ids.next("request");
  const sizeBoost = company.size === "enterprise" ? 1.5 : company.size === "small" ? 0.5 : 1;
  const hasRental = base.rules.rows.some((r) => r.service === "car_with_driver"), hasDriverless = base.rules.rows.some((r) => r.service === "car_without_driver");
  const service = rng.weighted<RequestPlan["service"]>([["delivery_driver", 100 - 2.6 * sizeBoost - 1.3 * sizeBoost], ["car_with_driver", hasRental ? 2.6 * sizeBoost : 0], ["car_without_driver", hasDriverless ? 1.3 * sizeBoost : 0]]);
  const pickupCity = cfg.cities.find((c) => c.pickup)?.key ?? "riyadh";
  let vehicleType = rng.weighted(company.vehicleMix.map(([v, w]) => [v, w] as const));
  let temperature: string | null = null;
  const lang = company.lang;
  const wh = company.warehouse;

  // lead time: how far ahead of publishing the job starts
  const draftGap = rng.weighted([[rng.int(1, 6) * MIN, 40], [rng.int(6, 40) * MIN, 45], [rng.int(40, 300) * MIN, 15]] as const);
  const tp = tc + draftGap;
  let startsAt: number;

  if (service === "delivery_driver") {
    // vehicle must have a price; cold chain companies ask for cold, others mostly dry
    const needsTemp = TEMPERATURE_VEHICLES.includes(vehicleType);
    if (needsTemp) temperature = rng.chance(company.industry.startsWith("Cold") ? 0.8 : company.industry.startsWith("Food") ? 0.3 : 0.12) ? "cold" : "dry";
    const delivery = rng.weighted(company.deliveryMix.map(([c, w]) => [c, w] as const));
    let rule = base.rules.resolve({ service, vehicleType, temperature, pickupCity, deliveryCity: delivery });
    let deliveryCity = delivery;
    if (!rule) { deliveryCity = pickupCity; rule = base.rules.resolve({ service, vehicleType, temperature, pickupCity, deliveryCity }); }
    if (!rule) { vehicleType = "sedan"; temperature = null; rule = base.rules.resolve({ service, vehicleType, pickupCity, deliveryCity }); }
    if (!rule) return null;
    // size: log-normal around the company's typical manifest
    const count = clamp(Math.round(rng.logNormal(company.parcelMedian, company.parcelSigma)), 1, company.size === "enterprise" ? 120 : company.size === "medium" ? 45 : 18);
    const perVehicle: Record<string, [number, number]> = { sedan: [12, 30], dokker: [18, 40], hiace: [25, 60], van: [25, 60], dyna: [40, 90] };
    const [lo, hi] = perVehicle[vehicleType] ?? [15, 30];
    const perDriver = rng.int(lo, hi);
    const shape = slotShape(count, perDriver);
    // start: mostly the same day, then the next morning, a few days ahead
    const lead = rng.weighted([["same", 60], ["next", 28], ["two", 8], ["far", 4]] as const);
    const tpDay = ksaDayStart(tp);
    if (lead === "same") startsAt = tp + rng.int(60, 270) * MIN;
    else if (lead === "next") startsAt = tpDay + DAY + hourOfStart(rng, "morning") * HOUR + rng.int(0, 3) * 15 * MIN;
    else if (lead === "two") startsAt = tpDay + 2 * DAY + hourOfStart(rng, "any") * HOUR;
    else startsAt = tpDay + rng.int(3, 5) * DAY + hourOfStart(rng, "any") * HOUR;
    startsAt = toQuarter(Math.max(startsAt, tp + 50 * MIN));
    { const h = ksa(startsAt).hour; if (h >= 21 || h < 6) startsAt = toQuarter(ksaDayStart(startsAt + (h >= 21 ? DAY : 0)) + rng.int(8, 10) * HOUR + rng.int(0, 3) * 15 * MIN); } // nobody starts a delivery shift at night
    const ref = refOf("request", n);
    const parcels = makeParcels(ctx, rng, company, ref, count, deliveryCity, lang);
    const reqNotes = rng.chance(0.12) ? rng.pick(["Fragile items", "يرجى الاتصال عند الوصول", "Use gate 2", "Keep upright"]) : null;
    return {
      n, id, ref, company, service, tc, tp, startsAt, durationDays: 1, quantity: shape.quantity, perDriver: shape.shipmentsPerDriver, vehicleType, temperature, pickupCity, deliveryCity, rule, parcels,
      allowPartial: !rng.chance(0.1), via: company.apiKey && rng.chance(0.8) ? "api" : rng.chance(0.13) ? "mobile" : "web", title: rng.chance(0.4) ? `${company.companyName} — ${count} parcels` : null, notes: reqNotes,
      pickupAddress: `${company.address}`, deliveryAddress: null, pickupLat: wh.lat, pickupLng: wh.lng, deliveryLat: null, deliveryLng: null, abandoned: false, lang,
    };
  }

  // rentals (vehicle × days)
  const rentalVehicle = rng.weighted([["sedan", 4], ["dokker", 3], ["hiace", 3], ["van", 2]] as const);
  const rule = base.rules.resolve({ service, vehicleType: rentalVehicle, pickupCity, deliveryCity: pickupCity });
  if (!rule) return null;
  const days = service === "car_without_driver" ? rng.weighted([[1, 30], [2, 26], [3, 20], [5, 12], [7, 8], [14, 4]] as const) : rng.weighted([[1, 22], [2, 18], [3, 18], [5, 16], [7, 14], [10, 8], [14, 4]] as const);
  const quantity = rng.weighted([[1, 60], [2, 25], [3, 10], [4, 5]] as const);
  startsAt = toQuarter(ksaDayStart(tp) + rng.int(1, 6) * DAY + hourOfStart(rng, "morning") * HOUR);
  return {
    n, id, ref: refOf("request", n), company, service, tc, tp, startsAt, durationDays: days, quantity, perDriver: null, vehicleType: rentalVehicle, temperature: null, pickupCity, deliveryCity: pickupCity, rule, parcels: [],
    allowPartial: true, via: rng.chance(0.15) ? "mobile" : "web", title: rng.chance(0.5) ? (service === "car_with_driver" ? "Vehicle with driver" : "Vehicle rental") : null, notes: null,
    pickupAddress: company.address, deliveryAddress: `${rng.int(1, 200)} ${rng.pick(STREETS)}, ${rng.pick(districtsOf(pickupCity))[0]}`, pickupLat: wh.lat, pickupLng: wh.lng, deliveryLat: null, deliveryLng: null, abandoned: false, lang,
  };
}

/** The manifest: one fully detailed parcel per row, pins scattered around real district centres of the delivery city. */
export function makeParcels(ctx: Ctx, rng: Rng, company: CompanySim, ref: string, count: number, city: string, lang: "en" | "ar"): ParcelSpec[] {
  const districts = districtsOf(city);
  const useRefs = company.apiKey || rng.chance(0.55);
  const refBase = rng.int(10_000, 90_000);
  // a request usually serves a few neighbouring districts, not the whole city
  const focus = rng.sample(districts, Math.min(districts.length, rng.int(2, 5)));
  const out: ParcelSpec[] = [];
  for (let i = 0; i < count; i++) {
    const d = rng.chance(0.85) ? rng.pick(focus) : rng.pick(districts);
    const p = jitter(rng, d[1], d[2], 1.3);
    const business = rng.chance(company.b2bRate);
    const cod = rng.chance(business ? company.codRate * 0.3 : company.codRate);
    const amount = cod ? Math.round(clamp(rng.logNormal(140, 0.9), 15, 3000)) * 100 + (rng.chance(0.25) ? 50 : 0) : 0; // SAR 15 … 3 000, a quarter of them with 50 halalas
    const arabic = lang === "ar" || rng.chance(0.25);
    out.push({
      seq: i + 1, code: `${ref}-${String(i + 1).padStart(3, "0")}`, externalRef: useRefs ? `ORD-${refBase + i}` : null, type: business ? "business" : "consumer",
      name: recipientName(rng, business), phone: recipientPhone(ctx.ids.seq("rphone") * 7 + rng.int(0, 6)),
      address: arabic ? `${rng.int(1, 300)} ${rng.pick(STREETS_AR)}، ${d[0]}` : `${rng.int(1, 300)} ${rng.pick(STREETS)}, ${d[0]}`, city, lat: p.lat, lng: p.lng, district: d[0],
      contents: rng.pick(company.contents), notes: rng.pick(NOTES_PARCEL) ?? null, codCents: amount,
    });
  }
  return out;
}

export { IdGen };
