import { z } from "zod";
import { VEHICLE_TYPES } from "../catalog";

export const uuid = z.string().uuid();
export const phone = z.string().min(8).max(20);
const cityKey = z.string().min(2).max(40);
const optStr = (n = 300) => z.string().trim().max(n).nullish().transform((v) => (v ? v : null));

/** One parcel of a manifest. B2C: a consumer (proved with their one-time code). B2B: a business (code, or a signed/stamped receipt photo). */
export const shipmentBody = z.object({
  recipientType: z.enum(["consumer", "business"]).nullish(),
  // Required unless the request is booked with `detailsLater: true` — prepareManifest enforces that with row-numbered messages.
  recipientName: z.string().trim().max(120).nullish(),
  recipientPhone: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(300).nullish(),
  city: cityKey.nullish(),
  lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
  contents: optStr(300), notes: optStr(500), externalRef: optStr(80), partnerId: z.string().uuid().nullish(),
  codCents: z.number().int().min(0).max(10_000_000).nullish(), // cash the driver collects on delivery (halalas)
});

export const requestBody = z.object({
  service: z.enum(["delivery_driver", "car_with_driver", "car_without_driver"]),
  title: optStr(120),
  quantity: z.coerce.number().int().min(1).max(500).default(1), // delivery requests with a manifest derive this from the parcel count
  shipmentsPerDriver: z.coerce.number().int().min(1).max(1000).nullish(),
  vehicleType: z.enum(VEHICLE_TYPES).nullish(),
  temperature: z.enum(["dry", "cold"]).nullish(),
  pickupCity: cityKey, deliveryCity: cityKey,
  pickupAddress: optStr(), pickupLat: z.number().min(-90).max(90).nullish(), pickupLng: z.number().min(-180).max(180).nullish(),
  deliveryAddress: optStr(), deliveryLat: z.number().min(-90).max(90).nullish(), deliveryLng: z.number().min(-180).max(180).nullish(),
  recipientName: optStr(120), recipientPhone: optStr(20), contents: optStr(300),
  startsAt: z.coerce.date(), durationDays: z.coerce.number().int().min(1).max(90).default(1),
  notes: optStr(500),
  shipments: z.array(shipmentBody).max(2000).nullish(),
  shipmentCount: z.coerce.number().int().min(0).max(2000).nullish(),
  allowPartial: z.boolean().nullish(),
  detailsLater: z.boolean().nullish(), // book by count: recipient name / phone / address may follow (before hand-over)
});
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(), status: z.string().optional(), q: z.string().max(80).optional() });
