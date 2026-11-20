"use client";
import { useState } from "react";
import { ShieldCheck, ShieldX, Smartphone, Users } from "lucide-react";
import { Badge, ErrorState, Notice, PageLoading, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { qs, useTx } from "./admin-common";
import { pagerFooter } from "./admin-offices-common";
import { SensitiveOnly } from "./admin-driver-common";
import { CredentialsCard } from "./admin-credentials-card";

const SIZE = 15;
const ua = (s: string | null) => (s ? (s.length > 70 ? `${s.slice(0, 67)}…` : s) : "—");

/**
 * Sign-in security of a driver or an office: attempts with address, client and result, sessions, devices and the messages sent to the account, with the sign-in details staff manage (username, reset password).
 * Personal data — needs `drivers.sensitive`, and every look is written to the audit log by the server.
 */
export function SecurityPanel({ id, kind }: { id: string; kind: "driver" | "office" }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const sensitive = hasPerm(me, "drivers.sensitive"); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(sensitive ? `/admin/${kind}s/${id}/security${qs({ page, pageSize: SIZE })}` : null, { keepPreviousData: true });
  if (!sensitive) return <SensitiveOnly />;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const s = data.summary; const when = (d: string | null) => (d ? fmtDateTime(d, locale) : "—");
  return (
    <div className="space-y-5" data-testid="dv2-security">
      <CredentialsCard id={id} />
      {s.lockedUntil && <Notice tone="danger" title={t("dv2.sec_locked")}>{t("dv2.sec_locked_until", { d: when(s.lockedUntil) })}</Notice>}
      {s.mustChangePassword && <Notice tone="warn">{t("dv2.sec_must_change")}</Notice>}
      <StatGrid cols={4}>
        <Stat label={t("dv2.sec_signins")} icon={<ShieldCheck className="size-5" />} tone="accent" value={s.success30} hint={t("dv2.sec_30d")} />
        <Stat label={t("dv2.sec_failed")} icon={<ShieldX className="size-5" />} tone={s.failed30 ? "danger" : "muted"} value={s.failed30} hint={t("dv2.sec_failed_total", { n: s.failedTotal })} />
        <Stat label={t("dv2.sec_ips")} icon={<Users className="size-5" />} tone="cyan" value={s.ips30} hint={t("dv2.sec_30d")} />
        <Stat label={t("dv2.sec_sessions")} icon={<Smartphone className="size-5" />} tone="gold" value={s.activeSessions} hint={s.lastLoginAt ? t("dv2.sec_last", { d: when(s.lastLoginAt), c: s.lastLoginClient ? t(`dv2.client_${s.lastLoginClient}`) : "—" }) : t("dv2.never_signed_in")} />
      </StatGrid>
      <Section title={t("dv2.sec_attempts")} description={t("dv2.sec_attempts_sub", { n: s.loginCount })} flush>
        <Table stack bare dense label={t("dv2.sec_attempts")} head={[t("common.date"), t("dv2.col_method"), t("dv2.col_result"), t("dv2.col_client"), t("dv2.col_ip"), t("dv2.col_device")]} footer={pagerFooter(page, data.total, SIZE, setPage)}
          empty={data.events.length === 0 ? <p className="p-4 text-sm text-muted">{t("dv2.sec_none")}</p> : undefined}>
          {data.events.map((e: any) => (
            <tr key={e.id}>
              <Td label={t("common.date")} className="whitespace-nowrap text-muted">{when(e.at)}</Td><Td label={t("dv2.col_method")}>{tx(`dv2.method_${e.method}`, e.method)}</Td>
              <Td label={t("dv2.col_result")}>{e.success ? <Badge tone="success">{t("dv2.result_ok")}</Badge> : <Badge tone="danger">{tx(`dv2.fail_${e.reason}`, e.reason ?? t("dv2.result_failed"))}</Badge>}</Td>
              <Td label={t("dv2.col_client")}>{e.client ? t(`dv2.client_${e.client}`) : "—"}</Td><Td label={t("dv2.col_ip")} className="ltr-num">{e.ip ?? "—"}</Td>
              <Td label={t("dv2.col_device")} className="max-w-64 text-xs text-muted"><span title={e.userAgent ?? undefined}>{ua(e.userAgent)}</span></Td>
            </tr>
          ))}
        </Table>
      </Section>
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("dv2.sec_sessions_title")} flush>
          <Table stack bare dense label={t("dv2.sec_sessions_title")} head={[t("dv2.col_started"), t("dv2.col_client"), t("dv2.col_ip"), t("common.status")]} empty={data.sessions.length === 0 ? <p className="p-4 text-sm text-muted">{t("dv2.sec_none")}</p> : undefined}>
            {data.sessions.map((x: any) => (
              <tr key={x.id}>
                <Td label={t("dv2.col_started")} className="whitespace-nowrap text-muted">{when(x.createdAt)}<span className="block text-xs">{t("dv2.sec_seen", { d: when(x.lastSeenAt) })}</span></Td><Td label={t("dv2.col_client")}>{x.client ? t(`dv2.client_${x.client}`) : "—"}</Td>
                <Td label={t("dv2.col_ip")} className="ltr-num">{x.ip ?? "—"}</Td>
                <Td label={t("common.status")}>{x.active ? <Badge tone="success">{t("dv2.sess_active")}</Badge> : <Badge>{x.revokeReason ? tx(`dv2.revoke_${x.revokeReason}`, x.revokeReason) : t("dv2.sess_expired")}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Section>
        <div className="space-y-5">
          <Section title={t("dv2.sec_devices")} description={t("dv2.sec_devices_sub")} flush>
            <Table stack bare dense label={t("dv2.sec_devices")} head={[t("dv2.col_device"), { label: t("dv2.col_logins"), align: "end" }, t("dv2.col_last_used")]} empty={data.devices.length === 0 ? <p className="p-4 text-sm text-muted">{t("dv2.sec_none")}</p> : undefined}>
              {data.devices.map((d: any, i: number) => (
                <tr key={i}><Td label={t("dv2.col_device")} className="max-w-56 text-xs"><span className="font-medium">{d.client ? t(`dv2.client_${d.client}`) : "—"}</span><span className="block text-muted" title={d.userAgent ?? undefined}>{ua(d.userAgent)}</span></Td><Td label={t("dv2.col_logins")} num>{d.logins}</Td><Td label={t("dv2.col_last_used")} className="whitespace-nowrap text-muted">{when(d.lastAt)}</Td></tr>
              ))}
            </Table>
          </Section>
          <Section title={t("dv2.sec_messages")} description={t("dv2.sec_messages_sub")} flush>
            <Table stack bare dense label={t("dv2.sec_messages")} head={[t("common.date"), t("wallet.type"), t("common.status")]} empty={data.messages.length === 0 ? <p className="p-4 text-sm text-muted">{t("dv2.sec_none")}</p> : undefined}>
              {data.messages.map((m: any) => (
                <tr key={m.id}><Td label={t("common.date")} className="whitespace-nowrap text-muted">{when(m.at)}</Td><Td label={t("wallet.type")}>{tx(`dv2.msg_${m.type}`, m.type)}<span className="block text-xs text-muted">{m.channel}{m.recipient && <> · <span className="ltr-num">{m.recipient}</span></>}</span></Td>
                  <Td label={t("common.status")}><Badge tone={m.status === "failed" ? "danger" : m.status === "queued" ? "warn" : "success"}>{tx(`dv2.msg_status_${m.status}`, m.status)}</Badge>{m.error && <span className="block text-xs text-danger" title={m.error}>{String(m.error).slice(0, 40)}</span>}</Td></tr>
              ))}
            </Table>
          </Section>
        </div>
      </div>
    </div>
  );
}
