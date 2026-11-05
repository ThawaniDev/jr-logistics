import { z } from "zod";
import { VEHICLE_TYPES } from "../catalog";

export const uuid = z.string().uuid();
export const phone = z.string().min(8).max(20);
const cityKey = z.string().min(2).max(40);
const optStr = (n = 300) => z.string().trim().max(n).nullish().transform((v) => (v ? v : null));

export const requestBody = z.object({
  service: z.enum(["delivery_driver", "car_with_driver", "car_without_driver"]),
  title: optStr(120),
  quantity: z.coerce.number().int().min(1).max(500),
  shipmentsPerDriver: z.coerce.number().int().min(1).max(1000).nullish(),
  vehicleType: z.enum(VEHICLE_TYPES).nullish(),
  temperature: z.enum(["dry", "cold"]).nullish(),
  pickupCity: cityKey, deliveryCity: cityKey,
  pickupAddress: optStr(), pickupLat: z.number().min(-90).max(90).nullish(), pickupLng: z.number().min(-180).max(180).nullish(),
  deliveryAddress: optStr(), deliveryLat: z.number().min(-90).max(90).nullish(), deliveryLng: z.number().min(-180).max(180).nullish(),
  recipientName: optStr(120), recipientPhone: optStr(20), contents: optStr(300),
  startsAt: z.coerce.date(), durationDays: z.coerce.number().int().min(1).max(90).default(1),
  notes: optStr(500), preferredOfficeId: uuid.nullish(),
});
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(), status: z.string().optional(), q: z.string().max(80).optional() });
