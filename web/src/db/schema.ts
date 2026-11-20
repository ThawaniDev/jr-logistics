import {
  pgTable, uuid, text, integer, bigserial, boolean, timestamp, jsonb, date, doublePrecision,
  index, uniqueIndex, check, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * All money is stored as integer halalas (1 SAR = 100). Never floats.
 * All timestamps are timestamptz (UTC). Public IDs are UUIDs.
 */
const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ───────────────────────── Identity ─────────────────────────
export const users = pgTable("users", {
  id: id(),
  role: text("role").notNull(), // business | driver | office | staff | admin
  phone: text("phone").unique(),
  email: text("email").unique(),
  username: text("username").unique(), // sign-in name: lower-case, 3–30 chars (lib/username.ts), unique
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  language: text("language").notNull().default("ar"),
  status: text("status").notNull().default("active"), // active | suspended
  city: text("city"),
  staffRole: text("staff_role"), // preset key for staff
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  // Two-step verification (staff/admin). Secret is stored encrypted; recovery codes only as hashes.
  totpSecret: text("totp_secret"),
  totpEnabledAt: ts("totp_enabled_at"),
  totpLastStep: integer("totp_last_step"), // last accepted 30 s window — a code can never be replayed
  totpRecovery: jsonb("totp_recovery").$type<string[]>(),
  isDemo: boolean("is_demo").notNull().default(false),
  source: text("source").notNull().default("self"), // how the account came to exist: self (registered) | admin (created by staff) | import | api | seed
  createdBy: uuid("created_by"), // the staff member who created it (source = admin)
  lastLoginAt: ts("last_login_at"), // last successful sign-in (decision G5)
  lastSeenAt: ts("last_seen_at"), // last authenticated request, throttled to one write per 5 minutes
  loginCount: integer("login_count").notNull().default(0),
  lastLoginIp: text("last_login_ip"),
  lastLoginClient: text("last_login_client"), // web | mobile | api
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("users_role_idx").on(t.role), index("users_status_idx").on(t.status), index("users_last_seen_idx").on(t.lastSeenAt)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  client: text("client").notNull().default("web"), // web | mobile | api
  userAgent: text("user_agent"),
  ip: text("ip"), // address the session was created from
  lastSeenAt: ts("last_seen_at"),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"), // logout | password_changed | suspended | permissions_changed | revoked …
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/** Staff roles (J8). `key` is the immutable slug stored in `users.staff_role`; a role's permissions are the effective permissions of its members. The six presets are system roles (`is_system`). */
export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean("is_system").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export type RoleRow = typeof roles.$inferSelect;

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: createdAt(),
}, (t) => [index("otp_phone_idx").on(t.phone, t.createdAt)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: ts("window_start").notNull().defaultNow(),
});

export const termsConsents = pgTable("terms_consents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  termsVersion: text("terms_version").notNull(),
  context: text("context").notNull().default("registration"), // registration | offer_accept | publish
  ip: text("ip"),
  acceptedAt: createdAt(),
});

// ───────────────────────── Profiles ─────────────────────────
/** Per-warehouse operating switches (see decisions E2/E3/E9/E10). */
export interface WarehouseOps { requireArrivalConfirmation: boolean; requireLoadingRecord: boolean; requireDeliveryOtp: boolean; requireSignature: boolean }

export const businessProfiles = pgTable("business_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  crNumber: text("cr_number"),
  taxNumber: text("tax_number"), // VAT number
  industry: text("industry"),
  address: text("address"),
  responsiblePerson: text("responsible_person"),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending|verified|rejected|info_requested|suspended
  verificationNote: text("verification_note"),
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
  warehouseLat: doublePrecision("warehouse_lat"), // where the warehouse is: drivers must be within `arrivalRadiusM` of it to check in
  warehouseLng: doublePrecision("warehouse_lng"),
  ops: jsonb("ops").$type<Partial<WarehouseOps>>(), // per-warehouse switches set by the platform; a missing key inherits `warehouseDefaults`
  ratingSum: integer("rating_sum").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
});

export const officeProfiles = pgTable("office_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  officeName: text("office_name").notNull(),
  crNumber: text("cr_number"),
  responsiblePerson: text("responsible_person"),
  address: text("address"),
  city: text("city"),
  bankName: text("bank_name"),
  iban: text("iban"),
  taxNumber: text("tax_number"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  verificationNote: text("verification_note"),
});

export const driverProfiles = pgTable("driver_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  nationalId: text("national_id"),
  vehicleType: text("vehicle_type"), // sedan|dokker|hiace|van|dyna
  vehicleTemperature: text("vehicle_temperature"), // dry|cold|null
  vehiclePlate: text("vehicle_plate"),
  services: text("services").array().notNull().default(sql`'{}'::text[]`),
  availability: text("availability").notNull().default("unavailable"),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending|verified|rejected|expired
  bankName: text("bank_name"),
  iban: text("iban"),
  officeId: uuid("office_id").references(() => users.id), // current affiliation (null = direct)
  officeLinkStatus: text("office_link_status").notNull().default("direct"), // direct | linked
  ratingSum: integer("rating_sum").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  suspendedUntil: ts("suspended_until"),
  strikesResetAt: ts("strikes_reset_at"), // cancellations before this moment no longer count toward the strike policy
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  locationAt: ts("location_at"),
}, (t) => [index("driver_office_idx").on(t.officeId), index("driver_avail_idx").on(t.availability, t.verificationStatus)]);

export const officeInvites = pgTable("office_invites", {
  id: id(),
  officeId: uuid("office_id").notNull().references(() => users.id),
  phone: text("phone").notNull(),
  driverId: uuid("driver_id").references(() => users.id),
  status: text("status").notNull().default("pending"), // pending|accepted|declined|cancelled
  createdAt: createdAt(),
  respondedAt: ts("responded_at"),
}, (t) => [index("invite_phone_idx").on(t.phone, t.status)]);

export const officeAgreements = pgTable("office_agreements", {
  id: id(),
  officeId: uuid("office_id").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("pending_acceptance"), // pending_acceptance|accepted|superseded
  terms: text("terms"),
  effectiveAt: ts("effective_at"),
  expiresAt: ts("expires_at"),
  createdBy: uuid("created_by").references(() => users.id),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
}, (t) => [index("agreement_office_idx").on(t.officeId, t.status)]);

// ───────────────────────── Documents ─────────────────────────
export const documents = pgTable("documents", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  ownerKind: text("owner_kind").notNull(), // driver | office | business
  type: text("type").notNull(),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  expiresOn: date("expires_on"),
  status: text("status").notNull().default("submitted"), // submitted|under_review|approved|rejected|info_requested
  reviewerId: uuid("reviewer_id").references(() => users.id),
  reviewNote: text("review_note"),
  reviewedAt: ts("reviewed_at"),
  createdAt: createdAt(),
}, (t) => [index("documents_owner_idx").on(t.ownerId, t.type)]);

// ───────────────────────── Config & pricing ─────────────────────────
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updatedAt(),
});

export const pricingRules = pgTable("pricing_rules", {
  id: id(),
  service: text("service").notNull(),
  vehicleType: text("vehicle_type"),
  temperature: text("temperature"),
  pickupCity: text("pickup_city"),
  deliveryCity: text("delivery_city"),
  businessId: uuid("business_id").references(() => users.id), // null = global
  unit: text("unit").notNull(), // shipment | vehicle_day | driver_day
  priceCents: integer("price_cents").notNull(),
  providerCostCents: integer("provider_cost_cents").notNull(),
  currency: text("currency").notNull().default("SAR"),
  status: text("status").notNull().default("approved"), // draft|approved|retired
  version: integer("version").notNull().default(1),
  agreementRef: text("agreement_ref"),
  effectiveAt: ts("effective_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
  approvedBy: uuid("approved_by").references(() => users.id),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("pricing_lookup_idx").on(t.service, t.status, t.vehicleType),
  check("pricing_positive", sql`${t.priceCents} > 0 AND ${t.providerCostCents} >= 0 AND ${t.providerCostCents} <= ${t.priceCents}`),
]);

// ───────────────────────── Requests & offers ─────────────────────────
export const requests = pgTable("requests", {
  id: id(),
  ref: text("ref").notNull().unique(),
  businessId: uuid("business_id").notNull().references(() => users.id),
  service: text("service").notNull(),
  title: text("title"),
  quantity: integer("quantity").notNull(), // drivers / vehicles needed
  shipmentsPerDriver: integer("shipments_per_driver"),
  vehicleType: text("vehicle_type"),
  temperature: text("temperature"),
  pickupCity: text("pickup_city").notNull(),
  deliveryCity: text("delivery_city").notNull(),
  pickupAddress: text("pickup_address"),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  deliveryAddress: text("delivery_address"),
  deliveryLat: doublePrecision("delivery_lat"),
  deliveryLng: doublePrecision("delivery_lng"),
  recipientName: text("recipient_name"),
  recipientPhone: text("recipient_phone"),
  contents: text("contents"),
  startsAt: ts("starts_at").notNull(),
  durationDays: integer("duration_days").notNull().default(1),
  notes: text("notes"),
  preferredOfficeId: uuid("preferred_office_id").references(() => users.id), // retired: office selection was cancelled by the owner (decision C9); never set any more
  allowPartial: boolean("allow_partial").notNull().default(true), // false = all-or-nothing: the request only runs if every slot is filled by its start time
  status: text("status").notNull().default("draft"),
  pricingSnapshot: jsonb("pricing_snapshot"),
  unitPriceCents: integer("unit_price_cents"),
  expectedUnits: integer("expected_units"), // per slot (shipments or days)
  totalCents: integer("total_cents"),
  reservedCents: integer("reserved_cents").notNull().default(0),
  slotsFilled: integer("slots_filled").notNull().default(0),
  officeWindowEndsAt: ts("office_window_ends_at"),
  createdVia: text("created_via").notNull().default("web"), // web | api | mobile
  cancelReason: text("cancel_reason"),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  publishedAt: ts("published_at"),
  completedAt: ts("completed_at"),
  cancelledAt: ts("cancelled_at"),
  firstOfferAt: ts("first_offer_at"), // milestones (decision G5): first offer sent / first driver accepted / every slot filled / work began / last event
  firstAcceptedAt: ts("first_accepted_at"),
  filledAt: ts("filled_at"),
  startedAt: ts("started_at"), // first driver's route approved (or, for count-based jobs, the hand-over recorded)
  lastActivityAt: ts("last_activity_at"),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("requests_business_idx").on(t.businessId, t.status),
  index("requests_status_idx").on(t.status, t.startsAt),
  index("requests_activity_idx").on(t.lastActivityAt),
  check("requests_qty", sql`${t.quantity} > 0`),
]);

export const offers = pgTable("offers", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  driverId: uuid("driver_id").notNull().references(() => users.id),
  officeId: uuid("office_id").references(() => users.id), // affiliation snapshot at offer time
  status: text("status").notNull().default("offered"),
  source: text("source").notNull().default("system"), // system | apply | manual | office | replacement
  isReplacement: boolean("is_replacement").notNull().default(false),
  replacesOfferId: uuid("replaces_offer_id"),
  expectedUnits: integer("expected_units").notNull(),
  expectedEarningCents: integer("expected_earning_cents").notNull(),
  acceptedAt: ts("accepted_at"),
  arrivedAt: ts("arrived_at"),
  arrivedLat: doublePrecision("arrived_lat"),
  arrivedLng: doublePrecision("arrived_lng"),
  attendanceAt: ts("attendance_at"),
  attendanceBy: uuid("attendance_by").references(() => users.id),
  loadedUnits: integer("loaded_units"),
  loadedAt: ts("loaded_at"),
  loadedAckByDriver: boolean("loaded_ack_by_driver"), // null=pending true=confirmed false=disputed
  routeApprovedAt: ts("route_approved_at"), // the driver reviewed and approved the fixed stop order — stops unlock from here
  routePlan: jsonb("route_plan"), // summary of the last best-route plan (provider, totals, warnings, signature) — see server/route-planner.ts
  deliveredUnits: integer("delivered_units"),
  deliveredAt: ts("delivered_at"),
  finalUnits: integer("final_units"),
  finalAt: ts("final_at"),
  cancelReason: text("cancel_reason"),
  cancelledAt: ts("cancelled_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("offers_request_idx").on(t.requestId, t.status),
  index("offers_driver_idx").on(t.driverId, t.status),
  index("offers_office_idx").on(t.officeId).where(sql`${t.officeId} is not null`),
  uniqueIndex("offers_unique_active").on(t.requestId, t.driverId).where(sql`${t.status} NOT IN ('rejected','expired','cancelled','no_show','replaced')`),
]);

/**
 * One row per parcel/stop. The warehouse supplies the manifest; a driver works through their stops strictly one by one.
 * `status`: pending (not yet handed over) → loaded → delivered | failed → returned (| missing, cancelled).
 */
export const shipments = pgTable("shipments", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").references(() => offers.id), // the driver slot that carries it; null = still in the pool
  seq: integer("seq").notNull(), // 1-based position in the manifest
  code: text("code").notNull().unique(), // <request ref>-<seq>, what the label / barcode carries
  externalRef: text("external_ref"), // the warehouse's own order / barcode number (also accepted when scanning)
  recipientType: text("recipient_type").notNull().default("consumer"), // consumer (B2C: OTP) | business (B2B: OTP or signed/stamped receipt)
  recipientName: text("recipient_name").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  contents: text("contents"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  stopOrder: integer("stop_order"), // the driver's fixed route position (set when handed over)
  deferCount: integer("defer_count").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  otpVersion: integer("otp_version").notNull().default(1), // the code is derived from (id, version): bumping the version invalidates the old one
  otpAttempts: integer("otp_attempts").notNull().default(0),
  otpSends: integer("otp_sends").notNull().default(0),
  notifiedAt: ts("notified_at"),
  loadedAt: ts("loaded_at"),
  arrivedAt: ts("arrived_at"), // driver reached this stop
  deliveredAt: ts("delivered_at"),
  deliveredLat: doublePrecision("delivered_lat"),
  deliveredLng: doublePrecision("delivered_lng"),
  deliveredDistanceM: integer("delivered_distance_m"), // pin distance, recorded for audit — never blocks
  proofType: text("proof_type"), // otp | receipt
  receiverName: text("receiver_name"),
  proofKey: text("proof_key"), // storage key of the receipt photo
  failReason: text("fail_reason"),
  failNote: text("fail_note"),
  failedAt: ts("failed_at"),
  returnedAt: ts("returned_at"),
  detailsComplete: boolean("details_complete").notNull().default(true), // false = the warehouse booked the parcel by count only: name / phone / address still to come (must be complete before hand-over)
  geoSource: text("geo_source"), // where lat/lng came from: 'given' (typed / imported) | 'geocoded' (looked up from the address when the route was planned)
  legDistanceM: integer("leg_distance_m"), // driving distance from the previous stop in the planned route
  legDurationS: integer("leg_duration_s"), // driving time from the previous stop (traffic-aware when Google planned it)
  legPolyline: text("leg_polyline"), // Google encoded polyline (precision 5) of that leg; null = estimate (the map draws a straight line)
  codCents: integer("cod_cents").notNull().default(0), // cash the driver collects from the recipient at delivery
  codCollectedCents: integer("cod_collected_cents"),
  codCollectedAt: ts("cod_collected_at"),
  loadedVia: text("loaded_via"), // warehouse | driver_scan
  partnerId: uuid("partner_id"), // the warehouse-system connection this parcel came from (see partner_connections); verified against the owner on every use
  partnerStatus: text("partner_status"), // last status the warehouse system reported for it (mirror, display only)
  partnerStatusAt: ts("partner_status_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("shipments_request_idx").on(t.requestId, t.status),
  index("shipments_offer_idx").on(t.offerId, t.status),
  uniqueIndex("shipments_request_ref_uniq").on(t.requestId, t.externalRef).where(sql`${t.externalRef} is not null`),
  uniqueIndex("shipments_request_seq_uniq").on(t.requestId, t.seq),
  index("shipments_incomplete_idx").on(t.requestId).where(sql`${t.detailsComplete} = false`),
  index("shipments_partner_ref_idx").on(t.partnerId, sql`lower(${t.externalRef})`).where(sql`${t.partnerId} is not null`),
]);

/** Evidence captured at a stop: a photo for a postponement / failed attempt, or the recipient's signature. */
export const shipmentMedia = pgTable("shipment_media", {
  id: id(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").references(() => offers.id),
  kind: text("kind").notNull(), // defer | fail | signature
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  note: text("note"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  usedAt: ts("used_at"), // set when an action consumed it
  createdAt: createdAt(),
}, (t) => [index("shipment_media_shipment_idx").on(t.shipmentId, t.kind)]);

/** Cash the warehouse (or ops) has received back from a driver for one order. outstanding = Σ collected − Σ remittances. */
export const codRemittances = pgTable("cod_remittances", {
  id: id(),
  ref: text("ref").notNull().unique(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  offerId: uuid("offer_id").notNull().references(() => offers.id),
  driverId: uuid("driver_id").notNull().references(() => users.id),
  businessId: uuid("business_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull(),
  receivedBy: uuid("received_by").notNull().references(() => users.id),
  receivedByRole: text("received_by_role").notNull(),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("cod_remittances_offer_idx").on(t.offerId), index("cod_remittances_business_idx").on(t.businessId, t.createdAt), index("cod_remittances_driver_idx").on(t.driverId)]);

export const jobEvents = pgTable("job_events", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id"),
  actorId: uuid("actor_id"),
  actorName: text("actor_name"),
  actorRole: text("actor_role").notNull().default("system"),
  type: text("type").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  payload: jsonb("payload"),
  createdAt: createdAt(),
}, (t) => [
  index("events_request_idx").on(t.requestId, t.createdAt),
  index("events_actor_idx").on(t.actorId, t.createdAt).where(sql`${t.actorId} is not null`),
  index("events_offer_idx").on(t.offerId, t.createdAt).where(sql`${t.offerId} is not null`),
]);

export const messages = pgTable("messages", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  senderRole: text("sender_role").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("messages_offer_idx").on(t.offerId, t.createdAt), index("messages_request_idx").on(t.requestId, t.createdAt)]);

export const ratings = pgTable("ratings", {
  id: id(),
  offerId: uuid("offer_id").notNull().references(() => offers.id),
  raterId: uuid("rater_id").notNull().references(() => users.id),
  rateeId: uuid("ratee_id").notNull().references(() => users.id),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ratings_unique").on(t.offerId, t.raterId), index("ratings_ratee_idx").on(t.rateeId, t.createdAt), check("stars_range", sql`${t.stars} BETWEEN 1 AND 5`)]);

export const custodyItems = pgTable("custody_items", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  offerId: uuid("offer_id").notNull().references(() => offers.id),
  itemType: text("item_type").notNull(),
  description: text("description"),
  qty: integer("qty").notNull().default(1),
  status: text("status").notNull().default("handed_over"), // handed_over|acknowledged|returned|not_returned|damaged
  handedOverBy: uuid("handed_over_by").references(() => users.id),
  acknowledgedAt: ts("acknowledged_at"),
  returnedAt: ts("returned_at"),
  returnNote: text("return_note"),
  createdAt: createdAt(),
}, (t) => [index("custody_offer_idx").on(t.offerId)]);

// ───────────────────────── Support & complaints ─────────────────────────
export const tickets = pgTable("tickets", {
  id: id(),
  ref: text("ref").notNull().unique(),
  openedBy: uuid("opened_by").notNull().references(() => users.id),
  requestId: uuid("request_id").references(() => requests.id),
  offerId: uuid("offer_id").references(() => offers.id),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  priority: text("priority").notNull().default("normal"), // normal | urgent
  status: text("status").notNull().default("open"), // open|in_review|resolved
  assignedTo: uuid("assigned_to").references(() => users.id),
  resolvedAt: ts("resolved_at"),
  firstResponseAt: ts("first_response_at"), // first public staff reply (or the resolution when nobody replied) — decision G5
  firstResponseBy: uuid("first_response_by"),
  reopenCount: integer("reopen_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("tickets_status_idx").on(t.status, t.priority),
  index("tickets_request_idx").on(t.requestId).where(sql`${t.requestId} is not null`),
  index("tickets_opener_idx").on(t.openedBy, t.createdAt),
]);

export const ticketReplies = pgTable("ticket_replies", {
  id: id(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  internal: boolean("internal").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("ticket_replies_ticket_idx").on(t.ticketId, t.createdAt)]);

/** A photo/PDF attached to a ticket message. Uploaded first (unattached), then linked by `attachmentIds` when the message is posted. */
export const ticketAttachments = pgTable("ticket_attachments", {
  id: id(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  replyId: uuid("reply_id").references(() => ticketReplies.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: createdAt(),
}, (t) => [index("ticket_attachments_ticket_idx").on(t.ticketId)]);

export const complaints = pgTable("complaints", {
  id: id(),
  ref: text("ref").notNull().unique(),
  filedBy: uuid("filed_by").notNull().references(() => users.id),
  filedByRole: text("filed_by_role").notNull(),
  requestId: uuid("request_id").references(() => requests.id),
  offerId: uuid("offer_id").references(() => offers.id),
  category: text("category").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"), // open|in_progress|resolved|closed
  handlerId: uuid("handler_id").references(() => users.id),
  resolution: text("resolution"),
  resolvedAt: ts("resolved_at"),
  holdsSettlement: boolean("holds_settlement").notNull().default(false),
  firstResponseAt: ts("first_response_at"), // first staff action on the complaint (note, assignment or status change) — decision G5
  firstResponseBy: uuid("first_response_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("complaints_status_idx").on(t.status),
  index("complaints_request_idx").on(t.requestId).where(sql`${t.requestId} is not null`),
  index("complaints_filer_idx").on(t.filedBy, t.createdAt),
]);

export const complaintNotes = pgTable("complaint_notes", {
  id: id(),
  complaintId: uuid("complaint_id").notNull().references(() => complaints.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  kind: text("kind").notNull().default("note"), // note | status | assign
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("complaint_notes_complaint_idx").on(t.complaintId, t.createdAt)]);

// ───────────────────────── Finance ─────────────────────────
export const walletAccounts = pgTable("wallet_accounts", {
  id: id(),
  ownerId: uuid("owner_id").references(() => users.id), // null for the platform account
  kind: text("kind").notNull(), // user | platform
  availableCents: integer("available_cents").notNull().default(0),
  reservedCents: integer("reserved_cents").notNull().default(0),
  heldCents: integer("held_cents").notNull().default(0), // pending withdrawals
  creditLimitCents: integer("credit_limit_cents").notNull().default(0), // B7: approved postpaid facility — available may go down to -creditLimit
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("wallet_owner_unique").on(t.ownerId),
  check("wallet_nonneg", sql`${t.availableCents} + ${t.creditLimitCents} >= 0 AND ${t.reservedCents} >= 0 AND ${t.heldCents} >= 0 AND ${t.creditLimitCents} >= 0`),
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  accountId: uuid("account_id").notNull().references(() => walletAccounts.id),
  kind: text("kind").notNull(), // topup|reserve|release_reserve|refund|payout|platform_fee|withdrawal_hold|withdrawal_paid|withdrawal_release|adjustment
  availableDeltaCents: integer("available_delta_cents").notNull().default(0),
  reservedDeltaCents: integer("reserved_delta_cents").notNull().default(0),
  heldDeltaCents: integer("held_delta_cents").notNull().default(0),
  requestId: uuid("request_id"),
  offerId: uuid("offer_id"),
  settlementId: uuid("settlement_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  simulated: boolean("simulated").notNull().default(false),
  note: text("note"),
  actorId: uuid("actor_id"),
  createdAt: createdAt(),
}, (t) => [
  index("ledger_account_idx").on(t.accountId, t.createdAt),
  index("ledger_request_idx").on(t.requestId, t.createdAt).where(sql`${t.requestId} is not null`),
  index("ledger_offer_idx").on(t.offerId).where(sql`${t.offerId} is not null`),
  index("ledger_settlement_idx").on(t.settlementId).where(sql`${t.settlementId} is not null`),
]);

export const settlements = pgTable("settlements", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  offerId: uuid("offer_id").notNull().references(() => offers.id).unique(),
  driverId: uuid("driver_id").notNull().references(() => users.id),
  officeId: uuid("office_id").references(() => users.id), // payee office, null = direct driver
  businessId: uuid("business_id").notNull().references(() => users.id),
  finalUnits: integer("final_units").notNull(),
  reservedCents: integer("reserved_cents").notNull(),
  customerCents: integer("customer_cents").notNull(), // unit price × final units
  providerCents: integer("provider_cents").notNull(), // provider cost × final units (payee net)
  marginCents: integer("margin_cents").notNull(),
  vatCents: integer("vat_cents").notNull().default(0),
  refundCents: integer("refund_cents").notNull(),
  adjustmentCents: integer("adjustment_cents").notNull().default(0),
  status: text("status").notNull().default("pending_review"), // pending_review|approved|batch_ready|paid|rejected|failed
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  paidAt: ts("paid_at"),
  batchId: uuid("batch_id"),
  note: text("note"),
  pricingSnapshot: jsonb("pricing_snapshot"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("settlements_status_idx").on(t.status), index("settlements_payee_idx").on(t.driverId, t.officeId), index("settlements_request_idx").on(t.requestId)]);

export const payoutBatches = pgTable("payout_batches", {
  id: id(),
  ref: text("ref").notNull().unique(),
  periodKey: text("period_key"),
  itemCount: integer("item_count").notNull().default(0),
  paidCount: integer("paid_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  results: jsonb("results"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const withdrawals = pgTable("withdrawals", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull(),
  iban: text("iban").notNull(),
  bankName: text("bank_name"),
  status: text("status").notNull().default("pending"), // pending|approved|paid|rejected
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: ts("decided_at"),
  paymentRef: text("payment_ref"),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("withdrawals_status_idx").on(t.status), index("withdrawals_user_idx").on(t.userId, t.createdAt), check("withdrawal_pos", sql`${t.amountCents} > 0`)]);

export const invoices = pgTable("invoices", {
  id: id(),
  number: text("number").notNull().unique(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  settlementId: uuid("settlement_id").references(() => settlements.id),
  businessId: uuid("business_id").notNull().references(() => users.id),
  subtotalCents: integer("subtotal_cents").notNull(),
  vatCents: integer("vat_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  vatPct: integer("vat_pct").notNull(),
  createdAt: createdAt(),
}, (t) => [index("invoices_request_idx").on(t.requestId)]);

export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ───────────────────────── Platform ─────────────────────────
export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  data: jsonb("data"),
  readAt: ts("read_at"),
  createdAt: createdAt(),
}, (t) => [
  index("notif_user_idx").on(t.userId, t.readAt, t.createdAt),
  index("notif_request_idx").on(sql`(${t.data}->>'requestId')`, t.createdAt).where(sql`${t.data} ? 'requestId'`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  diff: jsonb("diff"),
  ip: text("ip"),
  correlationId: text("correlation_id"),
  createdAt: createdAt(),
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt), index("audit_actor_idx").on(t.actorId, t.createdAt).where(sql`${t.actorId} is not null`)]);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default(sql`'{jobs:read,jobs:write}'::text[]`),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [index("apikeys_business_idx").on(t.businessId)]);

// ───────────────────────── Warehouse-system integrations ─────────────────────────
/** One connection from a business to a warehouse / order system (LogesTech, a custom webhook, …). Secrets are encrypted at rest. */
export const partnerConnections = pgTable("partner_connections", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => users.id),
  provider: text("provider").notNull(), // adapter key, see server/partners/registry.ts
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | disabled
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`), // non-secret provider settings (base URL, callback URL …)
  secretsEnc: text("secrets_enc"), // AES-256-GCM(JSON of the provider's secret fields)
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`), // behaviour toggles: which JR events are written back, auto-cancel …
  inboundTokenHash: text("inbound_token_hash"), // sha256 of the token the partner must present on our webhook URL
  inboundTokenPrefix: text("inbound_token_prefix"),
  lastCheckedAt: ts("last_checked_at"),
  lastOkAt: ts("last_ok_at"),
  lastError: text("last_error"),
  lastEventAt: ts("last_event_at"),
  lastPollAt: ts("last_poll_at"),
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`), // non-secret runtime state JR writes itself: webhook URL the partner registered, status catalogue, poll cursor …
  tokenVersion: integer("token_version").notNull().default(1), // bumped on credential rotation: signed access tokens of older versions stop working
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("partner_conn_business_idx").on(t.businessId), uniqueIndex("partner_conn_token_uniq").on(t.inboundTokenHash).where(sql`${t.inboundTokenHash} is not null`)]);

/** Everything that crossed the boundary, both ways, for support and audit. Payloads are trimmed; secrets are never stored. */
export const partnerEvents = pgTable("partner_events", {
  id: id(),
  connectionId: uuid("connection_id").notNull().references(() => partnerConnections.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),
  direction: text("direction").notNull(), // in | out | lookup | test
  kind: text("kind").notNull(), // status | cancelled | delivered | … | lookup | test
  externalId: text("external_id"),
  shipmentId: uuid("shipment_id"),
  requestId: uuid("request_id"),
  outcome: text("outcome").notNull().default("ok"), // ok | ignored | error
  summary: text("summary"),
  payload: jsonb("payload"),
  dedupeKey: text("dedupe_key"),
  partnerOrderId: uuid("partner_order_id"),
  createdAt: createdAt(),
}, (t) => [
  index("partner_events_order_idx").on(t.partnerOrderId, t.createdAt).where(sql`${t.partnerOrderId} is not null`),
  index("partner_events_conn_idx").on(t.connectionId, t.createdAt),
  index("partner_events_biz_idx").on(t.businessId, t.createdAt),
  index("partner_events_request_idx").on(t.requestId, t.createdAt).where(sql`${t.requestId} is not null`),
  index("partner_events_shipment_idx").on(t.shipmentId, t.createdAt).where(sql`${t.shipmentId} is not null`),
  uniqueIndex("partner_events_dedupe_uniq").on(t.connectionId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
]);

/** Write-back queue: every JR parcel event a partner wants (picked up, out for delivery, delivered …), sent strictly in order per parcel
 * (`seq`), once per occurrence (`dedupeKey`). Created in the same transaction as the JR event, so a rolled-back action never reaches the partner. */
export const partnerOutbox = pgTable("partner_outbox", {
  id: id(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  connectionId: uuid("connection_id").notNull().references(() => partnerConnections.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),
  shipmentId: uuid("shipment_id"), // null for order-level updates sent before the order became a JR parcel (e.g. "accepted")
  requestId: uuid("request_id"),
  partnerOrderId: uuid("partner_order_id"),
  action: text("action").notNull(), // a JrEvent (see server/partners/types.ts)
  dedupeKey: text("dedupe_key").notNull(), // "<action>:<occurrence>" — the same occurrence is never queued twice
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("queued"), // queued | retry_wait | sent | dead | skipped
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
}, (t) => [
  index("partner_outbox_due_idx").on(t.status, t.nextAttemptAt),
  uniqueIndex("partner_outbox_dedupe_uniq").on(t.connectionId, t.dedupeKey),
  index("partner_outbox_line_idx").on(t.connectionId, t.partnerOrderId, t.seq),
  index("partner_outbox_shipment_idx").on(t.connectionId, t.shipmentId, t.seq),
]);

/** Incoming orders: every order JR learns about from a warehouse system — pushed to JR (carrier APIs), imported (lookup / poll) or seen
 * on a webhook. `open` = waiting to be put in a JR delivery order; `linked` = a JR parcel carries it (`shipmentId`); `cancelled` = cancelled
 * on the partner's side before JR delivered it. */
export const partnerOrders = pgTable("partner_orders", {
  id: id(),
  connectionId: uuid("connection_id").notNull().references(() => partnerConnections.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id"), // the partner's internal id (Omniful system_id, LogesTech packageId, Shipox id, Fizzpa OrderId …)
  externalRef: text("external_ref").notNull(), // the reference the warehouse knows (order number / barcode); JR parcels carry it as externalRef
  invoice: text("invoice"),
  awb: text("awb"), // JR's own tracking number, issued for carrier-mode partners (Omniful, Fastcoo)
  state: text("state").notNull().default("open"), // open | linked | cancelled
  recipientName: text("recipient_name"),
  recipientPhone: text("recipient_phone"),
  recipientEmail: text("recipient_email"),
  address: text("address"),
  cityRaw: text("city_raw"), // the city as the partner wrote it
  city: text("city"), // JR city key when it could be matched
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  codCents: integer("cod_cents"), // null = the partner did not say (the business decides)
  currency: text("currency"),
  pieces: integer("pieces"),
  weightGrams: integer("weight_grams"),
  contents: text("contents"),
  notes: text("notes"),
  pickup: jsonb("pickup"), // { name, code, city, address, phone, lat, lng } as the partner sent it
  items: jsonb("items"), // [{ sku, name, qty }]
  slot: jsonb("slot"), // delivery window { from, to } (ISO) when given
  extra: jsonb("extra"), // provider-specific identifiers needed later (never secrets)
  detailsComplete: boolean("details_complete").notNull().default(false),
  partnerStatus: text("partner_status"),
  partnerStatusAt: ts("partner_status_at"),
  lastTrackedAt: ts("last_tracked_at"), // last time the scheduled check asked the partner (rotates fairly through open orders)
  shipmentId: uuid("shipment_id"),
  requestId: uuid("request_id"),
  cancelledAt: ts("cancelled_at"),
  cancelReason: text("cancel_reason"),
  cancelledBy: text("cancelled_by"), // partner | business | staff
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("partner_orders_ref_uniq").on(t.connectionId, sql`lower(${t.externalRef})`),
  uniqueIndex("partner_orders_awb_uniq").on(t.awb).where(sql`${t.awb} is not null`),
  index("partner_orders_biz_idx").on(t.businessId, t.state, t.createdAt),
  index("partner_orders_shipment_idx").on(t.shipmentId).where(sql`${t.shipmentId} is not null`),
  index("partner_orders_external_idx").on(t.connectionId, t.externalId).where(sql`${t.externalId} is not null`),
  index("partner_orders_ext_lower_idx").on(t.connectionId, sql`lower(${t.externalId})`).where(sql`${t.externalId} is not null`),
  index("partner_orders_track_idx").on(t.connectionId, t.lastTrackedAt),
]);
export type PartnerOrder = typeof partnerOrders.$inferSelect;
export type PartnerConnection = typeof partnerConnections.$inferSelect;

export const apiIdempotency = pgTable("api_idempotency", {
  key: text("key").notNull(),
  businessId: uuid("business_id").notNull(),
  requestHash: text("request_hash").notNull(),
  response: jsonb("response").notNull(),
  status: integer("status").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.businessId, t.key] })]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => users.id),
  requestId: uuid("request_id"),
  eventId: uuid("event_id").notNull().defaultRandom(),
  event: text("event").notNull(),
  url: text("url").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("queued"), // queued|delivered|retry_wait|dead_letter
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  deliveredAt: ts("delivered_at"),
  createdAt: createdAt(),
}, (t) => [index("webhook_due_idx").on(t.status, t.nextAttemptAt), index("webhook_request_idx").on(t.requestId, t.createdAt).where(sql`${t.requestId} is not null`)]);

export const apiLogs = pgTable("api_logs", {
  id: id(),
  businessId: uuid("business_id"),
  keyId: uuid("key_id"),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  latencyMs: integer("latency_ms"),
  createdAt: createdAt(),
});

// ───────────────────────── Operational Scenario MCQs ─────────────────────────
export const scenarioMcqs = pgTable("scenario_mcqs", {
  id: id(),
  flowNumber: integer("flow_number").notNull().unique(),
  categoryKey: text("category_key").notNull(),
  categoryName: text("category_name").notNull(),
  title: text("title").notNull(),
  processType: text("process_type").notNull(),
  badgeClass: text("badge_class").notNull().default("badge-auto"),
  scenario: text("scenario").notNull(),
  question: text("question").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctIndex: integer("correct_index").notNull(),
  selectedIndex: integer("selected_index").notNull(),
  answerText: text("answer_text").notNull(),
  explanation: text("explanation").notNull(),
  actors: jsonb("actors").$type<string[]>().notNull(),
  steps: jsonb("steps").$type<string[]>().notNull(),
  techState: text("tech_state").notNull(),
  apiCode: text("api_code").notNull(),
  finMath: jsonb("fin_math").$type<Array<{ label: string; val: string }>>().notNull(),
  decisionNote: text("decision_note"),
  customResponse: text("custom_response"),
  customResponseBy: text("custom_response_by"),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("scenario_mcqs_cat_idx").on(t.categoryKey, t.flowNumber),
]);

// ───────────────────────── Platform data capture (decisions G5–G7, migration 0012) ─────────────────────────
/** Every sign-in attempt, successful or not (OTP, password, API key). `identifier` is the phone / email as typed (normalised). */
export const loginEvents = pgTable("login_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  identifier: text("identifier"),
  method: text("method").notNull(), // otp | password | api_key | session
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"), // invalid_code | unknown_account | bad_password | locked | suspended | wrong_portal | mfa_failed | rate_limited …
  ip: text("ip"),
  userAgent: text("user_agent"),
  client: text("client"), // web | mobile | api
  sessionId: uuid("session_id"),
  createdAt: createdAt(),
}, (t) => [
  index("login_events_user_idx").on(t.userId, t.createdAt),
  index("login_events_created_idx").on(t.createdAt),
  index("login_events_identifier_idx").on(t.identifier, t.createdAt),
  index("login_events_failed_idx").on(t.createdAt).where(sql`${t.success} = false`),
]);

/** A driver's sampled path: at most one row per 60 s per driver (see server/data-capture.ts). Pruned after 90 days. */
export const driverLocationHistory = pgTable("driver_location_history", {
  id: id(),
  driverId: uuid("driver_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  speedMps: doublePrecision("speed_mps"),
  heading: doublePrecision("heading"),
  offerId: uuid("offer_id"), // the job the driver was on at the time (null = idle)
  recordedAt: ts("recorded_at").notNull().defaultNow(),
}, (t) => [
  index("dlh_driver_idx").on(t.driverId, t.recordedAt),
  index("dlh_offer_idx").on(t.offerId, t.recordedAt).where(sql`${t.offerId} is not null`),
  index("dlh_time_idx").on(t.recordedAt),
]);

/** Every change of a driver's availability, who/what caused it. */
export const driverAvailabilityLog = pgTable("driver_availability_log", {
  id: id(),
  driverId: uuid("driver_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"), // available | unavailable | null (first record)
  toStatus: text("to_status").notNull(),
  source: text("source").notNull(), // driver | system | admin
  reason: text("reason"), // manual | cancel_strikes | suspended | document_expired | …
  actorId: uuid("actor_id"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("dal_driver_idx").on(t.driverId, t.at), index("dal_at_idx").on(t.at)]);

/** The per-parcel journey: every state change of one shipment with who did it. */
export const shipmentEvents = pgTable("shipment_events", {
  id: id(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id"),
  type: text("type").notNull(), // created | edited | details_completed | assigned | unassigned | loaded | unscanned | route_positioned | arrived | otp_sent | otp_failed | otp_verified | deferred | failed | delivered | cod_collected | returned | missing | cancelled | reshipped | …
  actorId: uuid("actor_id"),
  actorRole: text("actor_role").notNull().default("system"),
  actorName: text("actor_name"),
  payload: jsonb("payload"),
  createdAt: createdAt(),
}, (t) => [
  index("shipment_events_shipment_idx").on(t.shipmentId, t.createdAt),
  index("shipment_events_request_idx").on(t.requestId, t.createdAt),
  index("shipment_events_type_idx").on(t.type, t.createdAt),
  index("shipment_events_offer_idx").on(t.offerId, t.createdAt).where(sql`${t.offerId} is not null`),
  index("shipment_events_actor_idx").on(t.actorId, t.createdAt).where(sql`${t.actorId} is not null`),
]);

/** Every message the platform sends out (SMS, outbound webhooks …). Recipients are masked; message bodies are never stored. */
export const messageLog = pgTable("message_log", {
  id: id(),
  channel: text("channel").notNull(), // sms | push | webhook | email | inapp
  direction: text("direction").notNull().default("out"),
  recipient: text("recipient"), // masked: last 4 digits of a phone, host of a webhook URL
  type: text("type").notNull(), // otp | recipient_code | recipient_track | driver_alert | office_alert | <webhook event> …
  userId: uuid("user_id"),
  requestId: uuid("request_id"),
  shipmentId: uuid("shipment_id"),
  status: text("status").notNull().default("queued"), // queued | sent | failed | delivered
  providerRef: text("provider_ref"), // provider message id / webhook delivery id
  error: text("error"),
  attempts: integer("attempts").notNull().default(1),
  sentAt: ts("sent_at"),
  meta: jsonb("meta"),
  createdAt: createdAt(),
}, (t) => [
  index("message_log_created_idx").on(t.createdAt),
  index("message_log_channel_idx").on(t.channel, t.status, t.createdAt),
  index("message_log_user_idx").on(t.userId, t.createdAt).where(sql`${t.userId} is not null`),
  index("message_log_request_idx").on(t.requestId, t.createdAt).where(sql`${t.requestId} is not null`),
  index("message_log_shipment_idx").on(t.shipmentId, t.createdAt).where(sql`${t.shipmentId} is not null`),
  index("message_log_ref_idx").on(t.providerRef).where(sql`${t.providerRef} is not null`),
]);

/** Hourly / daily platform and per-city numbers (supply, demand, liabilities …), written by the maintenance tick. Unique per (scope, at, city). */
export const metricSnapshots = pgTable("metric_snapshots", {
  id: id(),
  at: ts("at").notNull(), // start of the hour (UTC) or of the Riyadh calendar day
  scope: text("scope").notNull(), // hour | day
  city: text("city"), // null = the whole platform
  metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("metric_snapshots_uniq").on(t.scope, t.at, sql`coalesce(${t.city}, '')`),
  index("metric_snapshots_at_idx").on(t.scope, t.at),
  check("metric_snapshots_scope", sql`${t.scope} in ('hour','day')`),
]);

/** Internal staff notes on any entity (never shown to customers). Soft-deleted. */
export const entityNotes = pgTable("entity_notes", {
  id: id(),
  entity: text("entity").notNull(), // user | request | shipment | ticket | complaint | offer | settlement | withdrawal
  entityId: text("entity_id").notNull(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: createdAt(),
  deletedAt: ts("deleted_at"),
  deletedBy: uuid("deleted_by"),
}, (t) => [
  index("entity_notes_entity_idx").on(t.entity, t.entityId, t.createdAt),
  index("entity_notes_author_idx").on(t.authorId, t.createdAt),
  check("entity_notes_body", sql`char_length(${t.body}) between 1 and 4000`),
]);

export type User = typeof users.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type ScenarioMcq = typeof scenarioMcqs.$inferSelect;

export type Shipment = typeof shipments.$inferSelect;
export type LoginEvent = typeof loginEvents.$inferSelect;
export type ShipmentEvent = typeof shipmentEvents.$inferSelect;
export type MessageLogRow = typeof messageLog.$inferSelect;
export type EntityNote = typeof entityNotes.$inferSelect;
