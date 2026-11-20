"use client";
import { useState } from "react";
import Link from "next/link";
import { Bell, MessageCircle } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageLoading, Pagination, Section, StatusBadge, Table, Td, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useOrder } from "./admin-order-ctx";

const MSG_TONE: Record<string, Tone> = { sent: "success", delivered: "success", queued: "neutral", failed: "danger" };
const flat = (d: Record<string, unknown> | null) => Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, typeof v === "object" ? "" : String(v)]));

/** One driver's chat with the business, read-only, oldest first. */
function Thread({ th }: { th: any }) {
  const { t, locale } = useI18n(); const me = useUser();
  return (
    <div id={`offer-${th.offerId}`} className="scroll-mt-24 rounded-xl border border-line" data-testid="dv1-chat-thread">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-sm">
        <span className="font-semibold">{hasPerm(me, "drivers.view") ? <Link href={`/admin/drivers/${th.driverId}`} className="text-accent hover:underline">{th.driverName}</Link> : th.driverName}</span>
        <span className="flex items-center gap-2 text-xs text-muted"><StatusBadge status={th.status} />{t("dv1.chat_n", { n: th.messages.length })}</span>
      </div>
      <ul className="max-h-96 space-y-2 overflow-y-auto p-4">
        {th.messages.map((m: any) => {
          const driver = m.senderRole === "driver";
          return (
            <li key={m.id} className={cn("flex", driver ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", driver ? "rounded-ss-sm bg-bg2" : "rounded-se-sm bg-accent/10")}>
                <p className="text-xs font-semibold text-muted">{m.senderName} · {t(`role.${m.senderRole}`)}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-1 text-end text-[11px] text-muted">{fmtDateTime(m.createdAt, locale)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Communication: the chat transcripts per driver (read-only), the messages the platform sent about the order (SMS, webhooks — recipients masked, texts never stored) and the in-app notifications. */
export function OrderComms() {
  const { t, locale } = useI18n(); const tx = useTx();
  const { id } = useOrder();
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/admin/requests/${id}/communication${page > 1 ? `?page=${page}` : ""}`, { keepPreviousData: true, refreshInterval: 60000 });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const { chat, messages: msg, notifications: nt } = data;
  const failed = msg.stats.filter((s: any) => s.status === "failed").reduce((a: number, s: any) => a + s.n, 0);
  return (
    <div className="space-y-5" data-testid="dv1-comms">
      <Section title={t("dv1.chat_title")} description={chat.truncated ? t("dv1.chat_truncated", { shown: chat.shown, total: chat.total }) : t("dv1.chat_sub", { n: chat.total })} id="order-chat">
        {chat.threads.length === 0 ? <EmptyState icon={<MessageCircle className="size-9" aria-hidden />} title={t("dv1.chat_none")} hint={t("dv1.chat_none_hint")} /> : <div className="space-y-4">{chat.threads.map((th: any) => <Thread key={th.offerId} th={th} />)}</div>}
      </Section>

      <Section title={t("dv1.sent_title")} description={t("dv1.sent_sub")} id="order-messages" flush
        actions={msg.total > 0 ? <span className="flex gap-1.5">{msg.stats.map((s: any) => <Badge key={`${s.channel}-${s.status}`} tone={MSG_TONE[s.status] ?? "neutral"}>{tx(`dv1.ch_${s.channel}`, s.channel)} · {tx(`dv1.msgst_${s.status}`, s.status)} · {s.n}</Badge>)}</span> : undefined}>
        {msg.items.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.sent_none")} hint={t("dv1.sent_none_hint")} /></div> : (
          <>
            {failed > 0 && <p className="border-b border-line px-5 py-2.5 text-sm text-danger" data-testid="dv1-msg-failed">{t("dv1.sent_failed", { n: failed })}</p>}
            <Table bare dense stack label={t("dv1.sent_title")} head={[t("common.date"), t("dv1.col_channel"), t("dv1.col_type"), t("dv1.col_recipient"), t("dv1.col_parcel"), t("common.status"), t("dv1.col_attempts")]}>
              {msg.items.map((m: any) => (
                <tr key={m.id} data-testid="dv1-msg-row">
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(m.sentAt ?? m.createdAt, locale)}</Td>
                  <Td label={t("dv1.col_channel")}>{tx(`dv1.ch_${m.channel}`, m.channel)}</Td>
                  <Td label={t("dv1.col_type")}>{tx(`dv1.mt_${m.type}`, m.type.replace(/_/g, " "))}</Td>
                  <Td label={t("dv1.col_recipient")} className="ltr-num">{m.recipient ?? "—"}</Td>
                  <Td label={t("dv1.col_parcel")}>{m.shipmentId ? <Link href={`/admin/parcels/${m.shipmentId}`} className="ltr-num text-accent hover:underline">{m.shipmentCode}</Link> : "—"}</Td>
                  <Td label={t("common.status")}><Badge tone={MSG_TONE[m.status] ?? "neutral"}>{tx(`dv1.msgst_${m.status}`, m.status)}</Badge>{m.error && <p className="mt-1 max-w-56 text-xs text-danger">{m.error}</p>}</Td>
                  <Td label={t("dv1.col_attempts")} num>{m.attempts}</Td>
                </tr>
              ))}
            </Table>
            <div className="border-t border-line px-5 pb-4"><Pagination page={page} total={msg.total} pageSize={msg.pageSize} onPage={setPage} /></div>
          </>
        )}
      </Section>

      <Section title={t("dv1.notif_title")} description={nt.total > nt.shown ? t("dv1.notif_truncated", { shown: nt.shown, total: nt.total }) : t("dv1.notif_sub", { n: nt.total })} id="order-notifications" flush>
        {nt.items.length === 0 ? <div className="p-5"><EmptyState icon={<Bell className="size-9" aria-hidden />} title={t("dv1.notif_none")} /></div> : (
          <Table bare dense stack label={t("dv1.notif_title")} head={[t("common.date"), t("dv1.col_recipient"), t("dv1.col_notification"), t("common.status")]}>
            {nt.items.map((n: any) => {
              const text = t(`notif.${n.type}`, flat(n.data));
              return (
                <tr key={n.id} data-testid="dv1-notif-row">
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(n.createdAt, locale)}</Td>
                  <Td label={t("dv1.col_recipient")}>{n.userName} <span className="text-xs text-muted">({tx(`role.${n.userRole}`, n.userRole)})</span></Td>
                  <Td label={t("dv1.col_notification")}>{text.startsWith("notif.") ? t("ubz.notif_generic") : text}</Td>
                  <Td label={t("common.status")}>{n.readAt ? <Badge>{t("dv1.notif_read")}</Badge> : <Badge tone="warn">{t("dv1.notif_unread")}</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>
    </div>
  );
}
