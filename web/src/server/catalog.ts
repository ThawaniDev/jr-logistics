/** Static domain catalog. Dynamic/enabled values live in `settings`. */

export type ServiceKey = "delivery_driver" | "car_with_driver" | "car_without_driver";

export interface ServiceDef {
  key: ServiceKey;
  unit: "shipment" | "vehicle_day";
  hasShipments: boolean;
  needsVehicle: boolean;
  driverless: boolean;
}

/** Only the three services in the approved scope are modelled. Others are intentionally absent. */
export const SERVICES: ServiceDef[] = [
  { key: "delivery_driver", unit: "shipment", hasShipments: true, needsVehicle: true, driverless: false },
  { key: "car_with_driver", unit: "vehicle_day", hasShipments: false, needsVehicle: true, driverless: false },
  { key: "car_without_driver", unit: "vehicle_day", hasShipments: false, needsVehicle: true, driverless: true },
];
export const SERVICE_MAP = Object.fromEntries(SERVICES.map((s) => [s.key, s])) as Record<ServiceKey, ServiceDef>;

export const VEHICLE_TYPES = ["sedan", "dokker", "hiace", "van", "dyna"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
/** Vehicles for which dry/cold capability applies. */
export const TEMPERATURE_VEHICLES: readonly string[] = ["van", "dyna"];
export const TEMPERATURES = ["dry", "cold"] as const;

export const DEFAULT_CITIES = [
  { key: "riyadh", ar: "الرياض", en: "Riyadh", ur: "ریاض", lat: 24.7136, lng: 46.6753, pickup: true, delivery: true },
  { key: "jeddah", ar: "جدة", en: "Jeddah", ur: "جدہ", lat: 21.4858, lng: 39.1925, pickup: false, delivery: true },
  { key: "dammam", ar: "الدمام", en: "Dammam", ur: "دمام", lat: 26.4207, lng: 50.0888, pickup: false, delivery: true },
  { key: "khobar", ar: "الخبر", en: "Khobar", ur: "الخبر", lat: 26.2172, lng: 50.1971, pickup: false, delivery: true },
  { key: "makkah", ar: "مكة المكرمة", en: "Makkah", ur: "مکہ مکرمہ", lat: 21.3891, lng: 39.8579, pickup: false, delivery: true },
  { key: "madinah", ar: "المدينة المنورة", en: "Madinah", ur: "مدینہ منورہ", lat: 24.5247, lng: 39.5692, pickup: false, delivery: true },
  { key: "tabuk", ar: "تبوك", en: "Tabuk", ur: "تبوک", lat: 28.3838, lng: 36.555, pickup: false, delivery: true },
  { key: "abha", ar: "أبها", en: "Abha", ur: "ابہا", lat: 18.2164, lng: 42.5053, pickup: false, delivery: true },
  { key: "buraydah", ar: "بريدة", en: "Buraydah", ur: "بریدہ", lat: 26.326, lng: 43.975, pickup: false, delivery: true },
] as const;

export const ROLES = ["business", "driver", "office", "staff", "admin"] as const;
export type Role = (typeof ROLES)[number];

// ── Request / offer state machine ──
export const REQUEST_STATUS = [
  "draft", "published", "filling", "assigned", "confirmed", "in_progress", "completed", "cancelled", "expired",
] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];
export const REQUEST_TERMINAL: RequestStatus[] = ["completed", "cancelled", "expired"];
export const REQUEST_ACTIVE: RequestStatus[] = ["published", "filling", "assigned", "confirmed", "in_progress"];

export const OFFER_STATUS = [
  "offered", "accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed",
  "pending_settlement", "completed", "rejected", "expired", "cancelled", "no_show", "replaced",
] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

/** A driver holding any of these is busy and counts against overlap checks (single source of truth). */
export const OFFER_BUSY: OfferStatus[] = [
  "accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement",
];
export const OFFER_DEAD: OfferStatus[] = ["rejected", "expired", "cancelled", "no_show", "replaced"];

// ── Permissions ──
export const ALL_PERMISSIONS = [
  "users.view", "users.edit", "drivers.view", "drivers.sensitive",
  "requests.view", "requests.edit", "requests.assign",
  "attendance.edit", "replacements.manage", "live_location.view",
  "tickets.view", "tickets.manage", "complaints.manage", "custody.view",
  "finance.view", "wallets.view", "wallet.adjust",
  "settlements.review", "settlements.approve", "payouts.execute", "withdrawals.manage",
  "pricing.view", "pricing.edit", "refunds.manage",
  "reports.view", "reports.export",
  "staff.view", "staff.manage",
  "offices.view", "offices.manage", "verification.manage", "documents.review",
  "settings.view", "settings.edit", "audit.view", "broadcast.send",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const STAFF_PRESETS: Record<string, Permission[]> = {
  support: ["users.view", "requests.view", "tickets.view", "tickets.manage", "complaints.manage"],
  operations: [
    "users.view", "drivers.view", "requests.view", "requests.edit", "requests.assign", "attendance.edit",
    "replacements.manage", "live_location.view", "tickets.view", "tickets.manage", "complaints.manage",
    "custody.view", "documents.review",
  ],
  finance: [
    "finance.view", "wallets.view", "settlements.review", "settlements.approve", "payouts.execute",
    "withdrawals.manage", "refunds.manage", "requests.view", "reports.view", "reports.export",
  ],
  hr_verification: [
    "users.view", "users.edit", "drivers.view", "drivers.sensitive", "verification.manage", "documents.review",
    "offices.view", "offices.manage",
  ],
  account_manager: ["users.view", "requests.view", "pricing.view", "reports.view", "tickets.view", "offices.view"],
  reports: ["reports.view", "reports.export", "audit.view", "requests.view"],
};

// ── Documents ──
export const DRIVER_DOC_TYPES = [
  { key: "national_id", required: true },
  { key: "driving_license", required: true },
  { key: "vehicle_registration", required: true },
  { key: "vehicle_photo", required: false },
] as const;
export const OFFICE_DOC_TYPES = [
  { key: "office_cr", required: true },
  { key: "office_license", required: true },
  { key: "iban_certificate", required: false },
  { key: "other", required: false },
] as const;
export const BUSINESS_DOC_TYPES = [
  { key: "business_cr", required: true },
  { key: "tax_certificate", required: false },
] as const;

// ── Support taxonomy ──
export const TICKET_CATEGORIES = {
  business: ["driver_no_show", "shipment_count", "location_issue", "payment_issue", "replacement_request", "urgent", "other"],
  driver: ["business_not_ready", "not_put_to_work", "shipment_count_differs", "location_issue", "attendance_issue", "payment_issue", "other"],
  office: ["driver_assignment", "settlement_issue", "payment_issue", "agreement", "documents", "urgent", "other"],
} as const;
export const URGENT_TICKET_CATEGORIES = ["urgent", "driver_no_show", "business_not_ready", "not_put_to_work"];
export const COMPLAINT_CATEGORIES = ["delay", "behavior", "service_quality", "payment", "custody", "damage", "no_show", "other"] as const;
export const CUSTODY_ITEM_TYPES = ["pos_device", "network_device", "phone", "charger", "bag", "other"] as const;
