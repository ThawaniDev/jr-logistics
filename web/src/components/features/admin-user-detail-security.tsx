"use client";
import { Badge, EmptyState, ErrorState, Notice, Section, Skeleton, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import { KpiTile } from "./admin-company-detail-kpis";
import { CredentialsCard, idFromPath } from "./admin-credentials-card";

export interface SecurityData {
  account: { status: string; lastLoginAt: string | null; lastSeenAt: string | null; loginCount: number; lastLoginIp: string | null; lastLoginClient: string | null; failedLogins: number; lockedUntil: string | null; mustChangePassword: boolean };
  stats: { ok30: number; failed30: number; ips30: number | null; web: number; mobile: number; api: number };
  events: Array<{ id: string; at: string; method: string; success: boolean; failureReason: string | null; ip: string | null; device: string | null; client: string | null }>;
  sessions: Array<{ id: string; client: string; device: string | null; ip: string | null; lastSeenAt: string | null; createdAt: string; expiresAt: string }>;
  ended: Array<{ id: string; client: string; device: string | null; ip: string | null; createdAt: string; endedAt: string | null; reason: string | null }>;
  apiKeys?: Array<{ id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; calls30: number }> | null;
  sensitiveHidden: boolean;
}

/**
 * Sign-ins and sessions of one account (companies, drivers, offices, staff alike): last sign-in, attempts in the last 30 days, live sessions, the newest attempts and ended
 * sessions with why they ended. Addresses and devices are masked for staff without `drivers.sensitive`. No admin action ends a single session, so the page offers none
 * (suspending the account ends all of them).
 */
export function SecurityView({ path, testId = "dv3-security" }: { path: string; testId?: string }) {
  const { t, locale } = useI18n(); const tx = useTx();
  const { data, error, mutate } = useApi<SecurityData>(path, { shouldRetryOnError: false });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  const a = data.account, s = data.stats, locked = !!a.lockedUntil && new Date(a.lockedUntil) > new Date();
  const when = (v: string | null) => (v ? fmtDateTime(v, locale) : t("dv3.never"));
  const addr = (v: string | null) => (v ? <span dir="ltr" className="ltr-num">{v}</span> : "—");
  return (
    <div className="space-y-5" data-testid={testId}>
      {idFromPath(path) && <CredentialsCard id={idFromPath(path)!} />}
      {data.sensitiveHidden && <Notice tone="info">{t("dv3.sec_masked")}</Notice>}
      {locked && <Notice tone="danger" title={t("dv3.sec_locked")}><span data-testid="dv3-sec-locked">{t("dv3.sec_locked_until", { when: fmtDateTime(a.lockedUntil, locale) })}</span></Notice>}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <KpiTile id="s-last" plain label={t("dv3.f_last_login")} def={t("dv3.sd_last")} value={a.lastLoginAt ? fmtDateTime(a.lastLoginAt, locale) : t("dv3.never")} hint={a.lastLoginClient ? `${t(`dv3.client_${a.lastLoginClient}`)}${a.lastLoginIp ? ` · ${a.lastLoginIp}` : ""}` : undefined} />
        <KpiTile id="s-ok" label={t("dv3.sec_ok30")} def={t("dv3.sd_ok")} value={fmtNum(s.ok30, locale)} hint={t("dv3.sec_clients", { web: s.web, mobile: s.mobile, api: s.api })} />
        <KpiTile id="s-failed" label={t("dv3.sec_failed30")} def={t("dv3.sd_failed")} value={fmtNum(s.failed30, locale)} tone={s.failed30 >= 5 ? "danger" : s.failed30 > 0 ? "gold" : undefined} hint={a.failedLogins > 0 ? t("dv3.sec_streak", { n: a.failedLogins }) : undefined} />
        <KpiTile id="s-sessions" label={t("dv3.sec_sessions")} def={t("dv3.sd_sessions")} value={fmtNum(data.sessions.length, locale)} hint={s.ips30 != null ? t("dv3.sec_ips", { n: s.ips30 }) : undefined} />
      </div>

      <Section title={t("dv3.sec_active")} description={t("dv3.sec_active_sub")} flush>
        {data.sessions.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.sec_no_sessions")} /></div> : (
          <Table bare stack label={t("dv3.sec_active")} head={[t("dv3.sec_device"), t("dv3.sec_address"), t("dv3.sec_started"), t("dv3.sec_last_seen"), t("dv3.sec_expires")]}>
            {data.sessions.map((x) => (
              <tr key={x.id} data-testid="dv3-session-row">
                <Td label={t("dv3.sec_device")}><span className="inline-flex flex-wrap items-center gap-1.5">{t(`dv3.client_${x.client}`)}{x.device && <span className="text-xs text-muted">{x.device}</span>}</span></Td>
                <Td label={t("dv3.sec_address")}>{addr(x.ip)}</Td>
                <Td label={t("dv3.sec_started")} className="whitespace-nowrap text-muted">{fmtDateTime(x.createdAt, locale)}</Td>
                <Td label={t("dv3.sec_last_seen")} className="whitespace-nowrap text-muted">{when(x.lastSeenAt)}</Td>
                <Td label={t("dv3.sec_expires")} className="whitespace-nowrap text-muted">{fmtDateTime(x.expiresAt, locale)}</Td>
              </tr>))}
          </Table>)}
      </Section>

      <Section title={t("dv3.sec_attempts")} description={t("dv3.sec_attempts_sub")} flush>
        {data.events.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.sec_no_events")} /></div> : (
          <Table bare stack label={t("dv3.sec_attempts")} head={[t("common.date"), t("dv3.sec_method"), t("dv3.sec_result"), t("dv3.sec_address"), t("dv3.sec_device")]}>
            {data.events.map((e) => (
              <tr key={e.id} data-testid="dv3-login-row">
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.at, locale)}</Td>
                <Td label={t("dv3.sec_method")}>{t(`dv3.sec_m_${e.method}`)}</Td>
                <Td label={t("dv3.sec_result")}>{e.success ? <Badge tone="success">{t("dv3.sec_ok")}</Badge> : <span className="inline-flex flex-wrap items-center gap-1.5"><Badge tone="danger">{t("dv3.sec_failed")}</Badge>{e.failureReason && <span className="text-xs text-muted">{tx(`dtk.fail_${e.failureReason}`, e.failureReason)}</span>}</span>}</Td>
                <Td label={t("dv3.sec_address")}>{addr(e.ip)}</Td>
                <Td label={t("dv3.sec_device")} className="text-muted">{e.client ? t(`dv3.client_${e.client}`) : "—"}{e.device && <span className="block text-xs">{e.device}</span>}</Td>
              </tr>))}
          </Table>)}
      </Section>

      {data.ended.length > 0 && (
        <Section title={t("dv3.sec_ended")} flush>
          <Table bare stack dense label={t("dv3.sec_ended")} head={[t("dv3.sec_device"), t("dv3.sec_address"), t("dv3.sec_started"), t("dv3.sec_ended_at"), t("dv3.sec_reason")]}>
            {data.ended.map((x) => (
              <tr key={x.id}>
                <Td label={t("dv3.sec_device")}>{t(`dv3.client_${x.client}`)}{x.device && <span className="ms-1.5 text-xs text-muted">{x.device}</span>}</Td>
                <Td label={t("dv3.sec_address")}>{addr(x.ip)}</Td>
                <Td label={t("dv3.sec_started")} className="whitespace-nowrap text-muted">{fmtDateTime(x.createdAt, locale)}</Td>
                <Td label={t("dv3.sec_ended_at")} className="whitespace-nowrap text-muted">{x.endedAt ? fmtDateTime(x.endedAt, locale) : t("dv3.sec_expired")}</Td>
                <Td label={t("dv3.sec_reason")} className="text-muted">{x.reason ? tx(`dtk.revoke_${x.reason}`, x.reason) : "—"}</Td>
              </tr>))}
          </Table>
        </Section>)}

      {data.apiKeys && data.apiKeys.length > 0 && (
        <Section title={t("dv3.int_keys")} flush>
          <Table bare stack dense label={t("dv3.int_keys")} head={[t("common.name"), t("dv3.int_prefix"), t("dv3.int_last_used"), { label: t("dv3.int_calls"), align: "end" }, t("common.status")]}>
            {data.apiKeys.map((k) => (
              <tr key={k.id}>
                <Td label={t("common.name")} className="font-medium">{k.name}</Td>
                <Td label={t("dv3.int_prefix")}><code dir="ltr" className="ltr-num text-xs">{k.prefix}…</code></Td>
                <Td label={t("dv3.int_last_used")} className="whitespace-nowrap text-muted">{when(k.lastUsedAt)}</Td>
                <Td label={t("dv3.int_calls")} num>{fmtNum(k.calls30, locale)}</Td>
                <Td label={t("common.status")}>{k.revokedAt ? <Badge>{t("dv3.int_revoked")}</Badge> : <Badge tone="success">{t("status.active")}</Badge>}</Td>
              </tr>))}
          </Table>
        </Section>)}
    </div>
  );
}
