import { sql, type SQL } from "drizzle-orm";
import { MIRRORED_JOB_EVENTS } from "./shipment-events";
import { list, primitives, refsOf, sel, unionAll, uuidOf, short, type Source } from "./activity-sql";

/** The audit actions that have their own translated title (`dtk.act.<action>`); every other action falls back to the generic title with the action code. */
export const KNOWN_AUDIT_ACTIONS = [
  "auth.login", "auth.change_password", "auth.mfa_enable", "auth.mfa_disable", "auth.mfa_recovery_used", "user.register", "staff.create", "staff.update", "staff.reset_password", "staff.unlock", "staff.reset_mfa",
  "account.create", "account.update", "profile.iban_change", "request.cancel", "request.manual_assign", "request.rematch", "rental.fulfil", "offer.replace", "offer.end_route", "offer.confirm_returns",
  "dispute.resolve", "shipment.update", "shipment.cancel", "shipment.bulk_update", "settlement.pay", "withdrawal.paid", "withdrawal.rejected", "wallet.adjust", "wallet.credit_limit", "cod.receive",
  "ticket.update", "ticket.resolve", "ticket.reopen", "complaint.update", "pricing.create", "pricing.retire", "settings.update", "warehouse.location", "warehouse.ops", "driver.auto_suspend",
  "driver.clear_suspension", "location.view", "document.view", "report.export", "broadcast", "agreement.create", "agreement.accept", "office.unlink_driver", "note.add", "note.delete", "activity.export",
  "account.verify", "account.reject", "account.request_info", "account.suspend", "account.phone_change", "user.active", "user.suspended", "document.approved", "document.rejected", "document.info_requested",
  "office.link_driver", "settlement.review", "settlement.approve",
  "user.password_reset", "user.username_change", "role.create", "role.update", "role.delete", "role.reset",
] as const;
const MIRROR = sql.join(MIRRORED_JOB_EVENTS.map((t) => sql`${t}`), sql`, `);

// ───────── Job events (request lifecycle) ─────────
const evCols = sel("e.id::text", "e.created_at", "e.actor_id", "e.actor_name", "e.actor_role", "e.type", "e.type || ' ' || coalesce(e.payload::text, '')",
  "jsonb_build_object('requestId', e.request_id, 'offerId', e.offer_id, 'oldStatus', e.old_status, 'newStatus', e.new_status, 'payload', e.payload)");
/** Parcel-level job events are shown from `shipment_events` instead (same facts, richer rows), so they are left out here. */
const ev = (where: SQL) => sql`select ${evCols} from job_events e where ${where} and not ((e.payload ? 'shipmentId') and e.type in (${MIRROR}))`;
const jobEvents: Source = {
  table: "job_events", group: "events", kind: "event", actor: true,
  build: {
    request: (c) => ev(sql`e.request_id = ${uuidOf(c.id)}`),
    offer: (c) => ev(sql`e.offer_id = ${uuidOf(c.id)}`),
    settlement: (c) => ev(sql`e.offer_id = ${uuidOf(c.offerId ?? c.id)}`),
    user: (c) => unionAll([
      ev(sql`e.actor_id = ${uuidOf(c.id)}`),
      ev(sql`e.actor_id is distinct from ${uuidOf(c.id)} and e.offer_id in (select id from offers where driver_id = ${uuidOf(c.id)} or office_id = ${uuidOf(c.id)})`),
      ev(sql`e.actor_id is distinct from ${uuidOf(c.id)} and e.offer_id is null and e.request_id in (select id from requests where business_id = ${uuidOf(c.id)})`),
    ]),
  },
  map: (r) => {
    const p = r.data?.payload ?? {};
    return { titleKey: `event.${r.type}`, params: { ...primitives(p), status: r.data?.newStatus ?? undefined }, refs: refsOf(r.data), details: { oldStatus: r.data?.oldStatus, newStatus: r.data?.newStatus, payload: r.data?.payload } };
  },
};

// ───────── Parcel journey ─────────
const shCols = sel("s.id::text", "s.created_at", "s.actor_id", "s.actor_name", "s.actor_role", "s.type", "s.type || ' ' || coalesce(sh.code, '') || ' ' || coalesce(s.payload::text, '')",
  "jsonb_build_object('shipmentId', s.shipment_id, 'requestId', s.request_id, 'offerId', s.offer_id, 'code', sh.code, 'payload', s.payload)");
const sh = (where: SQL) => sql`select ${shCols} from shipment_events s join shipments sh on sh.id = s.shipment_id where ${where}`;
const parcelEvents: Source = {
  table: "shipment_events", group: "events", kind: "parcel", actor: true,
  build: {
    request: (c) => sh(sql`s.request_id = ${uuidOf(c.id)}`),
    offer: (c) => sh(sql`s.offer_id = ${uuidOf(c.id)}`),
    shipment: (c) => sh(sql`s.shipment_id = ${uuidOf(c.id)}`),
    user: (c) => unionAll([
      sh(sql`s.actor_id = ${uuidOf(c.id)}`),
      sh(sql`s.actor_id is distinct from ${uuidOf(c.id)} and s.offer_id in (select id from offers where driver_id = ${uuidOf(c.id)} or office_id = ${uuidOf(c.id)})`),
      sh(sql`s.actor_id is distinct from ${uuidOf(c.id)} and s.offer_id is null and s.request_id in (select id from requests where business_id = ${uuidOf(c.id)})`),
    ]),
  },
  map: (r) => ({ titleKey: `dtk.p_${r.type}`, params: { code: r.data?.code, ...primitives(r.data?.payload, ["reason", "why", "stopOrder", "amountCents", "note", "proofType", "via", "distanceM", "attempts", "by"]) }, refs: refsOf(r.data).map((x) => (x.type === "shipment" ? { ...x, label: r.data?.code ?? null } : x)), details: r.data?.payload }),
};

/** Evidence photos / signatures captured at a stop. */
const mediaCols = sel("m.id::text", "m.created_at", "m.uploaded_by", "null::text", "null::text", "'media_' || m.kind", "m.kind || ' ' || coalesce(m.note, '')",
  "jsonb_build_object('shipmentId', m.shipment_id, 'requestId', m.request_id, 'offerId', m.offer_id, 'kind', m.kind, 'note', m.note, 'mime', m.mime, 'code', sh.code)");
const md = (where: SQL) => sql`select ${mediaCols} from shipment_media m join shipments sh on sh.id = m.shipment_id where ${where}`;
const media: Source = {
  table: "shipment_media", group: "events", kind: "parcel", actor: true,
  build: { request: (c) => md(sql`m.request_id = ${uuidOf(c.id)}`), offer: (c) => md(sql`m.offer_id = ${uuidOf(c.id)}`), shipment: (c) => md(sql`m.shipment_id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { code: r.data?.code, note: r.data?.note }, refs: refsOf(r.data), details: { kind: r.data?.kind, mime: r.data?.mime, note: r.data?.note } }),
};

// ───────── Audit log ─────────
const auCols = sel("a.id::text", "a.created_at", "a.actor_id", "null::text", "a.actor_role", "a.action", "a.action || ' ' || a.entity || ' ' || coalesce(a.entity_id, '') || ' ' || coalesce(a.diff::text, '')",
  "jsonb_build_object('entity', a.entity, 'entityId', a.entity_id, 'diff', a.diff, 'ip', a.ip, 'correlationId', a.correlation_id)");
const au = (where: SQL) => sql`select ${auCols} from audit_logs a where ${where}`;
const audit: Source = {
  table: "audit_logs", group: "audit", kind: "audit", actor: true,
  build: {
    request: (c) => unionAll([
      au(sql`a.entity = 'request' and a.entity_id = ${c.id}`),
      au(sql`a.entity = 'offer' and a.entity_id in (select id::text from offers where request_id = ${uuidOf(c.id)})`),
      au(sql`a.entity = 'shipment' and a.entity_id in (select id::text from shipments where request_id = ${uuidOf(c.id)})`),
    ]),
    offer: (c) => au(sql`a.entity = 'offer' and a.entity_id = ${c.id}`),
    shipment: (c) => au(sql`a.entity = 'shipment' and a.entity_id = ${c.id}`),
    user: (c) => unionAll([au(sql`a.actor_id = ${uuidOf(c.id)}`), au(sql`a.actor_id is distinct from ${uuidOf(c.id)} and a.entity in ('user', 'business', 'driver', 'office') and a.entity_id = ${c.id}`)]),
    ticket: (c) => au(sql`a.entity = 'ticket' and a.entity_id = ${c.id}`),
    complaint: (c) => au(sql`a.entity = 'complaint' and a.entity_id = ${c.id}`),
    settlement: (c) => au(sql`a.entity = 'settlement' and a.entity_id = ${c.id}`),
    withdrawal: (c) => au(sql`a.entity = 'withdrawal' and a.entity_id = ${c.id}`),
  },
  map: (r) => {
    const known = (KNOWN_AUDIT_ACTIONS as readonly string[]).includes(r.type);
    const e = r.data?.entity as string | undefined, eid = r.data?.entityId as string | undefined;
    const refs = e && eid && ["request", "offer", "shipment", "ticket", "complaint", "settlement", "withdrawal"].includes(e) ? [{ type: e as "request", id: eid }] : e === "user" && eid ? [{ type: "user" as const, id: eid }] : [];
    return { titleKey: known ? `dtk.act.${r.type}` : "dtk.audit_action", params: { action: r.type, entity: e }, refs, details: { entity: e, entityId: eid, diff: r.data?.diff, ip: r.data?.ip, correlationId: r.data?.correlationId } };
  },
};

// ───────── Notifications & chat ─────────
const nCols = sel("n.id::text", "n.created_at", "null::uuid", "null::text", "null::text", "n.type", "n.type || ' ' || coalesce(n.data::text, '')",
  "jsonb_build_object('userId', n.user_id, 'userName', u.name, 'data', n.data, 'read', n.read_at is not null)");
const nf = (where: SQL) => sql`select ${nCols} from notifications n join users u on u.id = n.user_id where ${where}`;
const notifications: Source = {
  table: "notifications", group: "notifications", kind: "notification", actor: false,
  build: {
    request: (c) => nf(sql`(n.data->>'requestId') = ${c.id} and n.data ? 'requestId'`),
    user: (c) => nf(sql`n.user_id = ${uuidOf(c.id)}`),
    ticket: (c) => (c.userIds?.length && c.ref ? nf(sql`n.user_id in (${list(c.userIds)}) and n.type like 'ticket%' and (n.data->>'ref') = ${c.ref}`) : nf(sql`false`)),
    complaint: (c) => (c.userIds?.length && c.ref ? nf(sql`n.user_id in (${list(c.userIds)}) and n.type like 'complaint%' and (n.data->>'ref') = ${c.ref}`) : nf(sql`false`)),
  },
  map: (r) => ({ titleKey: `notif.${r.type}`, params: { ...primitives(r.data?.data), recipient: r.data?.userName }, refs: refsOf(r.data?.data), details: { recipient: r.data?.userName, read: r.data?.read, data: r.data?.data } }),
};

const chCols = sel("m.id::text", "m.created_at", "m.sender_id", "u.name", "m.sender_role", "'message'", "m.body", "jsonb_build_object('offerId', m.offer_id, 'requestId', m.request_id, 'body', left(m.body, 2000))");
const ch = (where: SQL) => sql`select ${chCols} from messages m join users u on u.id = m.sender_id where ${where}`;
const chat: Source = {
  table: "messages", group: "chat", kind: "chat", actor: true,
  build: {
    request: (c) => ch(sql`m.request_id = ${uuidOf(c.id)}`),
    offer: (c) => ch(sql`m.offer_id = ${uuidOf(c.id)}`),
    user: (c) => unionAll([
      ch(sql`m.sender_id = ${uuidOf(c.id)}`),
      ch(sql`m.sender_id <> ${uuidOf(c.id)} and (m.offer_id in (select id from offers where driver_id = ${uuidOf(c.id)} or office_id = ${uuidOf(c.id)}) or m.request_id in (select id from requests where business_id = ${uuidOf(c.id)}))`),
    ]),
  },
  map: (r) => ({ titleKey: "dtk.chat_message", params: { role: r.actor_role, text: short(r.data?.body, 160) }, refs: refsOf(r.data), details: { body: r.data?.body } }),
};

// ───────── Money ─────────
const lgCols = sel("l.id::text", "l.created_at", "l.actor_id", "null::text", "null::text", "l.kind", "l.kind || ' ' || coalesce(l.note, '')",
  "jsonb_build_object('availableDeltaCents', l.available_delta_cents, 'reservedDeltaCents', l.reserved_delta_cents, 'heldDeltaCents', l.held_delta_cents, 'note', l.note, 'simulated', l.simulated, 'requestId', l.request_id, 'offerId', l.offer_id, 'settlementId', l.settlement_id, 'ownerId', w.owner_id, 'ownerName', o.name)");
const lg = (where: SQL) => sql`select ${lgCols} from ledger_entries l join wallet_accounts w on w.id = l.account_id left join users o on o.id = w.owner_id where ${where}`;
const ledger: Source = {
  table: "ledger_entries", group: "finance", kind: "money", actor: true,
  build: {
    request: (c) => lg(sql`l.request_id = ${uuidOf(c.id)}`),
    offer: (c) => lg(sql`l.offer_id = ${uuidOf(c.id)}`),
    settlement: (c) => lg(sql`l.settlement_id = ${uuidOf(c.id)}`),
    user: (c) => lg(sql`l.account_id in (select id from wallet_accounts where owner_id = ${uuidOf(c.id)})`),
    withdrawal: (c) => lg(sql`l.idempotency_key in (${list([`wd-hold:${c.id}`, `wd-paid:${c.id}`, `wd-rel:${c.id}`])})`),
  },
  map: (r, c) => ({
    titleKey: `ledger.${r.type}`, params: { amountCents: r.data?.availableDeltaCents || r.data?.reservedDeltaCents || r.data?.heldDeltaCents || 0, owner: r.data?.ownerName, note: r.data?.note },
    refs: [...refsOf(r.data), ...(r.data?.ownerId && c.entity !== "user" ? [{ type: "user" as const, id: r.data.ownerId, label: r.data.ownerName }] : [])], details: r.data,
  }),
};

const stCols = (when: string, type: string, actor: string) => sel(`s.id::text || ':${type}'`, when, actor, "null::text", "null::text", `'settlement_${type}'`, "coalesce(s.note, '') || ' ' || s.status",
  "jsonb_build_object('settlementId', s.id, 'requestId', s.request_id, 'offerId', s.offer_id, 'driverId', s.driver_id, 'officeId', s.office_id, 'businessId', s.business_id, 'status', s.status, 'finalUnits', s.final_units, 'customerCents', s.customer_cents, 'providerCents', s.provider_cents, 'marginCents', s.margin_cents, 'vatCents', s.vat_cents, 'refundCents', s.refund_cents, 'adjustmentCents', s.adjustment_cents, 'note', s.note)");
const stl = (where: SQL) => unionAll([
  sql`select ${stCols("s.created_at", "created", "null::uuid")} from settlements s where ${where}`,
  sql`select ${stCols("s.approved_at", "approved", "s.approved_by")} from settlements s where ${where} and s.approved_at is not null`,
  sql`select ${stCols("s.paid_at", "paid", "null::uuid")} from settlements s where ${where} and s.paid_at is not null`,
]);
const settlements: Source = {
  table: "settlements", group: "finance", kind: "money", actor: true,
  build: {
    request: (c) => stl(sql`s.request_id = ${uuidOf(c.id)}`), offer: (c) => stl(sql`s.offer_id = ${uuidOf(c.id)}`), settlement: (c) => stl(sql`s.id = ${uuidOf(c.id)}`),
    user: (c) => stl(sql`(s.driver_id = ${uuidOf(c.id)} or s.office_id = ${uuidOf(c.id)} or s.business_id = ${uuidOf(c.id)})`),
  },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { amountCents: r.type === "settlement_paid" ? r.data?.providerCents : r.data?.customerCents, status: r.data?.status, units: r.data?.finalUnits }, refs: refsOf(r.data), details: r.data }),
};

const wdCols = (when: string, type: string, actor: string, typeSql: string) => sel(`w.id::text || ':${type}'`, when, actor, "null::text", "null::text", typeSql, "coalesce(w.note, '') || ' ' || w.status",
  "jsonb_build_object('withdrawalId', w.id, 'userId', w.user_id, 'amountCents', w.amount_cents, 'status', w.status, 'bankName', w.bank_name, 'paymentRef', w.payment_ref, 'note', w.note)");
const wd = (where: SQL) => unionAll([
  sql`select ${wdCols("w.created_at", "requested", "w.user_id", "'withdrawal_requested'")} from withdrawals w where ${where}`,
  sql`select ${wdCols("w.decided_at", "decided", "w.decided_by", "'withdrawal_' || w.status")} from withdrawals w where ${where} and w.decided_at is not null`,
]);
const withdrawals: Source = {
  table: "withdrawals", group: "finance", kind: "money", actor: true,
  build: { user: (c) => wd(sql`w.user_id = ${uuidOf(c.id)}`), withdrawal: (c) => wd(sql`w.id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { amountCents: r.data?.amountCents, status: r.data?.status, paymentRef: r.data?.paymentRef }, refs: refsOf(r.data), details: r.data }),
};

const ivCols = sel("i.id::text", "i.created_at", "null::uuid", "null::text", "null::text", "'invoice_created'", "i.number",
  "jsonb_build_object('requestId', i.request_id, 'settlementId', i.settlement_id, 'number', i.number, 'subtotalCents', i.subtotal_cents, 'vatCents', i.vat_cents, 'totalCents', i.total_cents, 'vatPct', i.vat_pct)");
const iv = (where: SQL) => sql`select ${ivCols} from invoices i where ${where}`;
const invoices: Source = {
  table: "invoices", group: "finance", kind: "money", actor: false,
  build: { request: (c) => iv(sql`i.request_id = ${uuidOf(c.id)}`), settlement: (c) => iv(sql`i.settlement_id = ${uuidOf(c.id)}`), user: (c) => iv(sql`i.business_id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: "dtk.invoice_created", params: { number: r.data?.number, amountCents: r.data?.totalCents }, refs: refsOf(r.data), details: r.data }),
};

const cdCols = sel("c.id::text", "c.created_at", "c.received_by", "null::text", "c.received_by_role", "'cod_remitted'", "c.ref || ' ' || coalesce(c.note, '')",
  "jsonb_build_object('requestId', c.request_id, 'offerId', c.offer_id, 'driverId', c.driver_id, 'businessId', c.business_id, 'ref', c.ref, 'amountCents', c.amount_cents, 'note', c.note)");
const cd = (where: SQL) => sql`select ${cdCols} from cod_remittances c where ${where}`;
const cod: Source = {
  table: "cod_remittances", group: "finance", kind: "money", actor: true,
  build: { request: (c) => cd(sql`c.request_id = ${uuidOf(c.id)}`), offer: (c) => cd(sql`c.offer_id = ${uuidOf(c.id)}`), user: (c) => cd(sql`(c.driver_id = ${uuidOf(c.id)} or c.business_id = ${uuidOf(c.id)} or c.received_by = ${uuidOf(c.id)})`) },
  map: (r) => ({ titleKey: "dtk.cod_remitted", params: { ref: r.data?.ref, amountCents: r.data?.amountCents }, refs: refsOf(r.data), details: r.data }),
};

export const CORE_SOURCES: Source[] = [jobEvents, parcelEvents, media, audit, notifications, chat, ledger, settlements, withdrawals, invoices, cod];
