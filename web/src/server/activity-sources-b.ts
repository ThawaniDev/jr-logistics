import { sql, type SQL } from "drizzle-orm";
import { primitives, refsOf, sel, unionAll, uuidOf, short, type Source } from "./activity-sql";

// ───────── Support: tickets, replies, attachments, complaints ─────────
const tkData = "jsonb_build_object('ticketId', t.id, 'ticketRef', t.ref, 'requestId', t.request_id, 'offerId', t.offer_id, 'category', t.category, 'subject', t.subject, 'priority', t.priority, 'status', t.status, 'reopenCount', t.reopen_count)";
const tkCols = (when: string, type: string, actor: string, role: string) => sel(`t.id::text || ':${type}'`, when, actor, "null::text", role, `'ticket_${type}'`, "t.ref || ' ' || t.subject", tkData);
const tk = (where: SQL) => unionAll([
  sql`select ${tkCols("t.created_at", "opened", "t.opened_by", "null::text")} from tickets t where ${where}`,
  sql`select ${tkCols("t.first_response_at", "first_response", "t.first_response_by", "null::text")} from tickets t where ${where} and t.first_response_at is not null`,
  sql`select ${tkCols("t.resolved_at", "resolved", "t.assigned_to", "null::text")} from tickets t where ${where} and t.resolved_at is not null`,
]);
const tickets: Source = {
  table: "tickets", group: "support", kind: "support", actor: true,
  build: {
    ticket: (c) => tk(sql`t.id = ${uuidOf(c.id)}`), request: (c) => tk(sql`t.request_id = ${uuidOf(c.id)}`), offer: (c) => tk(sql`t.offer_id = ${uuidOf(c.id)}`),
    user: (c) => tk(sql`(t.opened_by = ${uuidOf(c.id)} or t.assigned_to = ${uuidOf(c.id)})`),
  },
  map: (r, c) => ({ titleKey: `dtk.${r.type}`, params: primitives(r.data, ["ticketRef", "category", "subject", "priority", "status"]), refs: refsOf(r.data, c.entity === "ticket" ? { type: "ticket", id: c.id } : undefined), details: r.data }),
};

const rpCols = sel("r.id::text", "r.created_at", "r.author_id", "null::text", "r.author_role", "case when r.internal then 'ticket_internal_note' else 'ticket_reply' end", "r.body",
  "jsonb_build_object('ticketId', r.ticket_id, 'ticketRef', t.ref, 'requestId', t.request_id, 'internal', r.internal, 'body', left(r.body, 2000))");
const rp = (where: SQL) => sql`select ${rpCols} from ticket_replies r join tickets t on t.id = r.ticket_id where ${where}`;
const replies: Source = {
  table: "ticket_replies", group: "support", kind: "support", actor: true,
  build: {
    ticket: (c) => rp(sql`r.ticket_id = ${uuidOf(c.id)}`), request: (c) => rp(sql`t.request_id = ${uuidOf(c.id)}`), offer: (c) => rp(sql`t.offer_id = ${uuidOf(c.id)}`),
    user: (c) => rp(sql`(r.author_id = ${uuidOf(c.id)} or t.opened_by = ${uuidOf(c.id)})`),
  },
  map: (r, c) => ({ titleKey: `dtk.${r.type}`, params: { ticketRef: r.data?.ticketRef, role: r.actor_role, text: short(r.data?.body, 160) }, refs: refsOf(r.data, c.entity === "ticket" ? { type: "ticket", id: c.id } : undefined), details: { body: r.data?.body, internal: r.data?.internal } }),
};

const atCols = sel("a.id::text", "a.created_at", "a.uploaded_by", "null::text", "null::text", "'ticket_attachment'", "a.name",
  "jsonb_build_object('ticketId', a.ticket_id, 'ticketRef', t.ref, 'requestId', t.request_id, 'name', a.name, 'mime', a.mime, 'size', a.size)");
const at = (where: SQL) => sql`select ${atCols} from ticket_attachments a join tickets t on t.id = a.ticket_id where ${where}`;
const attachments: Source = {
  table: "ticket_attachments", group: "support", kind: "support", actor: true,
  build: { ticket: (c) => at(sql`a.ticket_id = ${uuidOf(c.id)}`), request: (c) => at(sql`t.request_id = ${uuidOf(c.id)}`), user: (c) => at(sql`(a.uploaded_by = ${uuidOf(c.id)} or t.opened_by = ${uuidOf(c.id)})`) },
  map: (r, c) => ({ titleKey: "dtk.ticket_attachment", params: primitives(r.data, ["name", "ticketRef"]), refs: refsOf(r.data, c.entity === "ticket" ? { type: "ticket", id: c.id } : undefined), details: { name: r.data?.name, mime: r.data?.mime, size: r.data?.size } }),
};

const cpData = "jsonb_build_object('complaintId', c.id, 'complaintRef', c.ref, 'requestId', c.request_id, 'offerId', c.offer_id, 'category', c.category, 'priority', c.priority, 'status', c.status, 'holdsSettlement', c.holds_settlement, 'resolution', c.resolution, 'description', left(c.description, 1000))";
const cpCols = (when: string, type: string, actor: string, role: string) => sel(`c.id::text || ':${type}'`, when, actor, "null::text", role, `'complaint_${type}'`, "c.ref || ' ' || c.description", cpData);
const cp = (where: SQL) => unionAll([
  sql`select ${cpCols("c.created_at", "filed", "c.filed_by", "c.filed_by_role")} from complaints c where ${where}`,
  sql`select ${cpCols("c.first_response_at", "first_response", "c.first_response_by", "null::text")} from complaints c where ${where} and c.first_response_at is not null`,
  sql`select ${cpCols("c.resolved_at", "resolved", "c.handler_id", "null::text")} from complaints c where ${where} and c.resolved_at is not null`,
]);
const complaints: Source = {
  table: "complaints", group: "support", kind: "support", actor: true,
  build: {
    complaint: (c) => cp(sql`c.id = ${uuidOf(c.id)}`), request: (c) => cp(sql`c.request_id = ${uuidOf(c.id)}`), offer: (c) => cp(sql`c.offer_id = ${uuidOf(c.id)}`),
    user: (c) => cp(sql`(c.filed_by = ${uuidOf(c.id)} or c.handler_id = ${uuidOf(c.id)})`),
  },
  map: (r, c) => ({ titleKey: `dtk.${r.type}`, params: primitives(r.data, ["complaintRef", "category", "priority", "status"]), refs: refsOf(r.data, c.entity === "complaint" ? { type: "complaint", id: c.id } : undefined), details: r.data }),
};

const cnCols = sel("n.id::text", "n.created_at", "n.author_id", "null::text", "n.author_role", "'complaint_' || n.kind", "n.body",
  "jsonb_build_object('complaintId', n.complaint_id, 'complaintRef', c.ref, 'requestId', c.request_id, 'kind', n.kind, 'body', left(n.body, 2000))");
const cn = (where: SQL) => sql`select ${cnCols} from complaint_notes n join complaints c on c.id = n.complaint_id where ${where}`;
const complaintNotes: Source = {
  table: "complaint_notes", group: "support", kind: "support", actor: true,
  build: { complaint: (c) => cn(sql`n.complaint_id = ${uuidOf(c.id)}`), request: (c) => cn(sql`c.request_id = ${uuidOf(c.id)}`), user: (c) => cn(sql`(n.author_id = ${uuidOf(c.id)} or c.filed_by = ${uuidOf(c.id)})`) },
  map: (r, c) => ({ titleKey: `dtk.${r.type}`, params: { complaintRef: r.data?.complaintRef, text: short(r.data?.body, 160) }, refs: refsOf(r.data, c.entity === "complaint" ? { type: "complaint", id: c.id } : undefined), details: { body: r.data?.body } }),
};

// ───────── Ratings, notes, documents ─────────
const rtCols = sel("r.id::text", "r.created_at", "r.rater_id", "null::text", "null::text", "'rating'", "coalesce(r.comment, '')",
  "jsonb_build_object('offerId', r.offer_id, 'requestId', o.request_id, 'stars', r.stars, 'comment', r.comment, 'rateeId', r.ratee_id)");
const rt = (where: SQL) => sql`select ${rtCols} from ratings r join offers o on o.id = r.offer_id where ${where}`;
const ratings: Source = {
  table: "ratings", group: "ratings", kind: "rating", actor: true,
  build: { request: (c) => rt(sql`o.request_id = ${uuidOf(c.id)}`), offer: (c) => rt(sql`r.offer_id = ${uuidOf(c.id)}`), user: (c) => rt(sql`(r.rater_id = ${uuidOf(c.id)} or r.ratee_id = ${uuidOf(c.id)})`) },
  map: (r, c) => ({ titleKey: `dtk.${c.entity === "user" && r.data?.rateeId === c.id ? "rating_received" : "rating"}${r.data?.comment ? "_c" : ""}`, params: { stars: r.data?.stars, comment: short(r.data?.comment, 160) }, refs: [...refsOf(r.data), ...(r.data?.rateeId && r.data.rateeId !== c.id ? [{ type: "user" as const, id: r.data.rateeId }] : [])], details: { stars: r.data?.stars, comment: r.data?.comment } }),
};

const ntCols = sel("n.id::text", "n.created_at", "n.author_id", "a.name", "a.role", "'note'", "n.body",
  "jsonb_build_object('entity', n.entity, 'entityId', n.entity_id, 'pinned', n.pinned, 'body', n.body)");
const nt = (where: SQL) => sql`select ${ntCols} from entity_notes n join users a on a.id = n.author_id where n.deleted_at is null and (${where})`;
const notes: Source = {
  table: "entity_notes", group: "notes", kind: "note", actor: true,
  build: Object.fromEntries((["offer", "shipment", "user", "ticket", "complaint", "settlement", "withdrawal"] as const).map((e) => [e, (c: { id: string }) => nt(sql`n.entity = ${e} and n.entity_id = ${c.id}`)])) as Source["build"],
  map: (r) => ({ titleKey: "dtk.note_added", params: { text: short(r.data?.body, 160), pinned: r.data?.pinned }, refs: [], details: { body: r.data?.body, pinned: r.data?.pinned, entity: r.data?.entity } }),
};
// a request also shows the notes written on its offers and parcels
notes.build.request = (c) => nt(sql`(n.entity = 'request' and n.entity_id = ${c.id}) or (n.entity = 'offer' and n.entity_id in (select id::text from offers where request_id = ${uuidOf(c.id)})) or (n.entity = 'shipment' and n.entity_id in (select id::text from shipments where request_id = ${uuidOf(c.id)}))`);

const dcCols = (when: string, type: string, actor: string, typeSql: string) => sel(`d.id::text || ':${type}'`, when, actor, "null::text", "null::text", typeSql, "d.type || ' ' || d.file_name || ' ' || coalesce(d.review_note, '')",
  "jsonb_build_object('documentId', d.id, 'ownerId', d.owner_id, 'ownerKind', d.owner_kind, 'type', d.type, 'status', d.status, 'fileName', d.file_name, 'mime', d.mime, 'reviewNote', d.review_note, 'expiresOn', d.expires_on)");
const dc = (where: SQL) => unionAll([
  sql`select ${dcCols("d.created_at", "submitted", "d.owner_id", "'document_submitted'")} from documents d where ${where}`,
  sql`select ${dcCols("d.reviewed_at", "reviewed", "d.reviewer_id", "'document_' || d.status")} from documents d where ${where} and d.reviewed_at is not null`,
]);
const documents: Source = {
  table: "documents", group: "documents", kind: "document", actor: true,
  build: { user: (c) => dc(sql`(d.owner_id = ${uuidOf(c.id)} or d.reviewer_id = ${uuidOf(c.id)})`) },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { docType: r.data?.type }, refs: r.data?.ownerId ? [{ type: "user", id: r.data.ownerId }] : [], details: { type: r.data?.type, status: r.data?.status, fileName: r.data?.fileName, reviewNote: r.data?.reviewNote, expiresOn: r.data?.expiresOn } }),
};

// ───────── Sign-ins, sessions, availability ─────────
const lgCols = sel("e.id::text", "e.created_at", "e.user_id", "null::text", "null::text", "case when e.success then 'login' else 'login_failed' end", "coalesce(e.identifier, '') || ' ' || coalesce(e.failure_reason, '') || ' ' || e.method",
  "jsonb_build_object('method', e.method, 'success', e.success, 'failureReason', e.failure_reason, 'identifier', e.identifier, 'ip', e.ip, 'userAgent', e.user_agent, 'client', e.client)");
const logins: Source = {
  table: "login_events", group: "logins", kind: "login", actor: true,
  build: {
    user: (c) => unionAll([
      sql`select ${lgCols} from login_events e where e.user_id = ${uuidOf(c.id)}`,
      // failed attempts against this person's phone / email that could not be tied to an account at the time
      sql`select ${lgCols} from login_events e where e.user_id is null and e.identifier in (select v from users u cross join lateral (values (u.phone), (u.email)) x(v) where u.id = ${uuidOf(c.id)} and v is not null)`,
    ]),
  },
  map: (r) => ({ titleKey: r.type === "login" ? "dtk.login_ok" : "dtk.login_failed", params: { method: r.data?.method, reason: r.data?.failureReason, client: r.data?.client }, refs: [], details: { method: r.data?.method, failureReason: r.data?.failureReason, identifier: r.data?.identifier, client: r.data?.client, ip: r.data?.ip, userAgent: r.data?.userAgent } }),
};

const ssCols = sel("s.id::text", "s.revoked_at", "s.user_id", "null::text", "null::text", "'session_revoked'", "coalesce(s.revoke_reason, '')",
  "jsonb_build_object('client', s.client, 'reason', s.revoke_reason, 'ip', s.ip, 'userAgent', s.user_agent, 'startedAt', s.created_at)");
const sessionsSrc: Source = {
  table: "sessions", group: "logins", kind: "login", actor: true,
  build: { user: (c) => sql`select ${ssCols} from sessions s where s.user_id = ${uuidOf(c.id)} and s.revoked_at is not null` },
  map: (r) => ({ titleKey: "dtk.session_revoked", params: { reason: r.data?.reason, client: r.data?.client }, refs: [], details: { reason: r.data?.reason, client: r.data?.client, startedAt: r.data?.startedAt, ip: r.data?.ip, userAgent: r.data?.userAgent } }),
};

const avCols = sel("l.id::text", "l.at", "l.actor_id", "null::text", "null::text", "'availability_' || l.to_status", "coalesce(l.reason, '') || ' ' || l.source",
  "jsonb_build_object('fromStatus', l.from_status, 'toStatus', l.to_status, 'source', l.source, 'reason', l.reason)");
const availability: Source = {
  table: "driver_availability_log", group: "availability", kind: "availability", actor: true,
  build: { user: (c) => sql`select ${avCols} from driver_availability_log l where l.driver_id = ${uuidOf(c.id)}` },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { source: r.data?.source, reason: r.data?.reason }, refs: [], details: r.data }),
};

// ───────── Outbound messages & integrations ─────────
const msCols = sel("m.id::text", "m.created_at", "null::uuid", "null::text", "null::text", "'message_' || m.channel", "m.type || ' ' || m.status || ' ' || coalesce(m.error, '')",
  "jsonb_build_object('channel', m.channel, 'type', m.type, 'status', m.status, 'recipient', m.recipient, 'error', m.error, 'attempts', m.attempts, 'providerRef', m.provider_ref, 'requestId', m.request_id, 'shipmentId', m.shipment_id, 'meta', m.meta)");
const ms = (where: SQL) => sql`select ${msCols} from message_log m where m.channel <> 'webhook' and ${where}`;
const messages: Source = {
  table: "message_log", group: "messages", kind: "message", actor: false,
  build: { user: (c) => ms(sql`m.user_id = ${uuidOf(c.id)}`), request: (c) => ms(sql`m.request_id = ${uuidOf(c.id)}`), shipment: (c) => ms(sql`m.shipment_id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: r.data?.status === "failed" ? "dtk.message_failed" : "dtk.message_sent", params: { channel: r.data?.channel, msgType: r.data?.type, recipient: r.data?.recipient, error: r.data?.error }, refs: refsOf(r.data), details: r.data }),
};

const peCols = sel("p.id::text", "p.created_at", "null::uuid", "null::text", "null::text", "'partner_' || p.direction || '_' || p.kind", "coalesce(p.summary, '') || ' ' || p.outcome",
  "jsonb_build_object('connectionId', p.connection_id, 'direction', p.direction, 'kind', p.kind, 'outcome', p.outcome, 'summary', p.summary, 'externalId', p.external_id, 'shipmentId', p.shipment_id, 'requestId', p.request_id)");
const pe = (where: SQL) => sql`select ${peCols} from partner_events p where ${where}`;
const partnerEvents: Source = {
  table: "partner_events", group: "integration", kind: "integration", actor: false,
  build: { request: (c) => pe(sql`p.request_id = ${uuidOf(c.id)}`), shipment: (c) => pe(sql`p.shipment_id = ${uuidOf(c.id)}`), user: (c) => pe(sql`p.business_id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: "dtk.partner_event", params: { direction: r.data?.direction, kind: r.data?.kind, outcome: r.data?.outcome, summary: short(r.data?.summary, 120) }, refs: refsOf(r.data), details: r.data }),
};

const whCols = sel("d.id::text", "d.created_at", "null::uuid", "null::text", "null::text", "'webhook_' || d.status", "d.event || ' ' || coalesce(d.last_error, '')",
  "jsonb_build_object('event', d.event, 'status', d.status, 'attempts', d.attempts, 'host', substring(d.url from '://([^/]+)'), 'lastStatusCode', d.last_status_code, 'lastError', d.last_error, 'requestId', d.request_id, 'deliveredAt', d.delivered_at)");
const wh = (where: SQL) => sql`select ${whCols} from webhook_deliveries d where ${where}`;
const webhooks: Source = {
  table: "webhook_deliveries", group: "integration", kind: "integration", actor: false,
  build: { request: (c) => wh(sql`d.request_id = ${uuidOf(c.id)}`), user: (c) => wh(sql`d.business_id = ${uuidOf(c.id)}`) },
  map: (r) => ({ titleKey: `dtk.${r.type}`, params: { event: r.data?.event, host: r.data?.host, attempts: r.data?.attempts, code: r.data?.lastStatusCode, error: r.data?.lastError }, refs: refsOf(r.data), details: r.data }),
};

export const MORE_SOURCES: Source[] = [tickets, replies, attachments, complaints, complaintNotes, ratings, notes, documents, logins, sessionsSrc, availability, messages, partnerEvents, webhooks];
