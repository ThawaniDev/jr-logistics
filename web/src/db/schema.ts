import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, date, doublePrecision,
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
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("users_role_idx").on(t.role), index("users_status_idx").on(t.status)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  client: text("client").notNull().default("web"), // web | mobile | api
  userAgent: text("user_agent"),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

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
export const businessProfiles = pgTable("business_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  crNumber: text("cr_number"),
  industry: text("industry"),
  address: text("address"),
  responsiblePerson: text("responsible_person"),
  verificationStatus: text("verification_status").notNull().default("pending"), // pending|verified|rejected|info_requested|suspended
  verificationNote: text("verification_note"),
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
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
  preferredOfficeId: uuid("preferred_office_id").references(() => users.id),
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
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("requests_business_idx").on(t.businessId, t.status),
  index("requests_status_idx").on(t.status, t.startsAt),
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
  uniqueIndex("offers_unique_active").on(t.requestId, t.driverId).where(sql`${t.status} NOT IN ('rejected','expired','cancelled','no_show','replaced')`),
]);

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
}, (t) => [index("events_request_idx").on(t.requestId, t.createdAt)]);

export const messages = pgTable("messages", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  senderRole: text("sender_role").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("messages_offer_idx").on(t.offerId, t.createdAt)]);

export const ratings = pgTable("ratings", {
  id: id(),
  offerId: uuid("offer_id").notNull().references(() => offers.id),
  raterId: uuid("rater_id").notNull().references(() => users.id),
  rateeId: uuid("ratee_id").notNull().references(() => users.id),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ratings_unique").on(t.offerId, t.raterId), check("stars_range", sql`${t.stars} BETWEEN 1 AND 5`)]);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("tickets_status_idx").on(t.status, t.priority)]);

export const ticketReplies = pgTable("ticket_replies", {
  id: id(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  internal: boolean("internal").notNull().default(false),
  createdAt: createdAt(),
});

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("complaints_status_idx").on(t.status)]);

export const complaintNotes = pgTable("complaint_notes", {
  id: id(),
  complaintId: uuid("complaint_id").notNull().references(() => complaints.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  kind: text("kind").notNull().default("note"), // note | status | assign
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Finance ─────────────────────────
export const walletAccounts = pgTable("wallet_accounts", {
  id: id(),
  ownerId: uuid("owner_id").references(() => users.id), // null for the platform account
  kind: text("kind").notNull(), // user | platform
  availableCents: integer("available_cents").notNull().default(0),
  reservedCents: integer("reserved_cents").notNull().default(0),
  heldCents: integer("held_cents").notNull().default(0), // pending withdrawals
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("wallet_owner_unique").on(t.ownerId),
  check("wallet_nonneg", sql`${t.availableCents} >= 0 AND ${t.reservedCents} >= 0 AND ${t.heldCents} >= 0`),
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
}, (t) => [index("ledger_account_idx").on(t.accountId, t.createdAt)]);

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
}, (t) => [index("settlements_status_idx").on(t.status), index("settlements_payee_idx").on(t.driverId, t.officeId)]);

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
}, (t) => [index("withdrawals_status_idx").on(t.status), check("withdrawal_pos", sql`${t.amountCents} > 0`)]);

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
});

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
}, (t) => [index("notif_user_idx").on(t.userId, t.readAt, t.createdAt)]);

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
}, (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt)]);

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
}, (t) => [index("webhook_due_idx").on(t.status, t.nextAttemptAt)]);

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

export type User = typeof users.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Offer = typeof offers.$inferSelect;
