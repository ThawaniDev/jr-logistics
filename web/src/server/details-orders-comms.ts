import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { loadOrder, isoOrNull, num, rowsOf, type Row } from "./details-orders";

const CHAT_MAX = 500, MSG_PAGE = 50, NOTIF_MAX = 100;
/**
 * Everything that was said or sent about one order (`requests.view`): the chat transcript per driver offer (read-only), the outbound messages (SMS, webhooks — recipients are
 * masked and message texts are never stored), and the in-app notifications created for it. Each part is bounded; the totals say how much more exists.
 */
export async function orderCommunication(user: User, id: string, q: { page?: number } = {}) {
  const r = await loadOrder(user, id);
  const page = Math.max(q.page ?? 1, 1), rid = r.id;
  const [chat, [chatCount], offerRows, msgs, [msgCount], msgStats, notifs, [notifCount]] = await Promise.all([
    rowsOf(sql`select * from (select m.id, m.offer_id, m.sender_id, m.sender_role, m.body, m.created_at, u.name sender_name from messages m join users u on u.id = m.sender_id where m.request_id = ${rid}::uuid order by m.created_at desc limit ${CHAT_MAX}) x order by created_at`),
    rowsOf(sql`select count(*)::int n from messages where request_id = ${rid}::uuid`),
    rowsOf(sql`select o.id, o.status, u.name driver_name, o.driver_id from offers o join users u on u.id = o.driver_id where o.request_id = ${rid}::uuid order by o.created_at`),
    rowsOf(sql`select l.id, l.channel, l.type, l.recipient, l.status, l.error, l.attempts, l.sent_at, l.created_at, l.shipment_id, s.code shipment_code, s.seq shipment_seq from message_log l left join shipments s on s.id = l.shipment_id
      where l.request_id = ${rid}::uuid order by l.created_at desc, l.id limit ${MSG_PAGE} offset ${(page - 1) * MSG_PAGE}`),
    rowsOf(sql`select count(*)::int n from message_log where request_id = ${rid}::uuid`),
    rowsOf(sql`select channel, status, count(*)::int n from message_log where request_id = ${rid}::uuid group by channel, status`),
    rowsOf(sql`select n.id, n.type, n.data, n.read_at, n.created_at, u.id user_id, u.name user_name, u.role user_role from notifications n join users u on u.id = n.user_id where n.data ? 'requestId' and n.data->>'requestId' = ${rid} order by n.created_at desc limit ${NOTIF_MAX}`),
    rowsOf(sql`select count(*)::int n from notifications where data ? 'requestId' and data->>'requestId' = ${rid}`),
  ]);
  const byOffer = new Map<string, Row[]>();
  for (const m of chat) byOffer.set(m.offer_id, [...(byOffer.get(m.offer_id) ?? []), { id: m.id, senderId: m.sender_id, senderRole: m.sender_role, senderName: m.sender_name, body: m.body, createdAt: isoOrNull(m.created_at) }]);
  const threads = offerRows.map((o) => ({ offerId: o.id, status: o.status, driverId: o.driver_id, driverName: o.driver_name, messages: byOffer.get(o.id) ?? [] })).filter((t) => t.messages.length > 0);
  return {
    request: { id: r.id, ref: r.ref },
    chat: { total: num(chatCount?.n), shown: chat.length, truncated: num(chatCount?.n) > chat.length, threads },
    messages: {
      page, pageSize: MSG_PAGE, total: num(msgCount?.n),
      stats: msgStats.map((s) => ({ channel: s.channel, status: s.status, n: num(s.n) })),
      items: msgs.map((m) => ({ id: m.id, channel: m.channel, type: m.type, recipient: m.recipient, status: m.status, error: m.error, attempts: num(m.attempts), sentAt: isoOrNull(m.sent_at), createdAt: isoOrNull(m.created_at), shipmentId: m.shipment_id, shipmentCode: m.shipment_code ?? null })),
    },
    notifications: { total: num(notifCount?.n), shown: notifs.length, items: notifs.map((n) => ({ id: n.id, type: n.type, data: n.data ?? null, readAt: isoOrNull(n.read_at), createdAt: isoOrNull(n.created_at), userId: n.user_id, userName: n.user_name, userRole: n.user_role })) },
  };
}
