"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BellRing, CheckCircle2, ChevronRight, Circle, CircleCheck, Coins, FileEdit, FilePlus2, FileText, HandCoins, MapPin, PackageCheck, PackageX, Plug, ShieldAlert, Wallet } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, Section, StatusBadge, Table, Td } from "@/components/ui";
import { parcelsOf } from "./business-shipments-lib";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

type Tone = "danger" | "warn" | "info";
export interface AttentionItem { key: string; tone: Tone; icon: ReactNode; text: string; href: string; cta: string }
const TONE_CLS: Record<Tone, string> = { danger: "border-danger/40 bg-danger/5", warn: "border-gold/40 bg-gold/5", info: "border-cyan/40 bg-cyan/5" };
const ICON_CLS: Record<Tone, string> = { danger: "text-danger", warn: "text-gold", info: "text-cyan" };

/** "Needs your attention": one row per thing the owner can fix right now, each with its own link. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const { t } = useI18n();
  return (
    <Section title={t("bz.action_needed")} description={t("rdz.attention_sub")} id="attention">
      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-accent" data-testid="dash-all-clear"><CheckCircle2 className="size-5 shrink-0" aria-hidden />{t("ubz.all_clear")}</div>
      ) : (
        <ul className="space-y-2" data-testid="dash-attention">
          {items.map((x) => (
            <li key={x.key} className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3", TONE_CLS[x.tone])}>
              <span className={ICON_CLS[x.tone]}>{x.icon}</span>
              <span className="min-w-0 flex-1 text-sm">{x.text}</span>
              <Link href={x.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-cyan hover:underline">{x.cta}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Orders where a driver is waiting for the warehouse (arrived → confirm attendance, delivered → confirm). */
export function WaitingOrders({ data }: { data: { items: any[]; total: number } }) {
  const { t, locale } = useI18n();
  if (!data.items.length) return null;
  return (
    <Section title={t("ubz.waiting_on_you")} flush actions={<Link href="/business/requests?status=action" className="text-sm text-cyan hover:underline">{t("common.view_all")}{data.total > data.items.length ? ` (${fmtNum(data.total, locale)})` : ""}</Link>}>
      <ul className="divide-y divide-line" data-testid="dash-waiting">
        {data.items.map((x) => (
          <li key={x.id}><Link href={`/business/requests/${x.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-bg2/60">
            <span className="ltr-num font-semibold text-accent">{x.ref}</span><span>{t(`svc.${x.service}`)}</span><span className="text-muted">{fmtDateTime(x.startsAt, locale)}</span>
            <span className="ms-auto flex items-center gap-2"><StatusBadge status={x.status} /><Badge tone="warn">{t("ubz.action_badge")}</Badge><ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden /></span>
          </Link></li>
        ))}
      </ul>
    </Section>
  );
}

export function RecentOrders({ items, needIds, blocked }: { items: any[]; needIds: Set<string>; blocked: boolean }) {
  const { t, locale } = useI18n();
  return (
    <Section title={t("biz.recent")} flush actions={<Link href="/business/requests" className="text-sm text-cyan hover:underline">{t("common.view_all")}</Link>}>
      {items.length === 0 ? (
        <div className="p-5"><EmptyState title={t("biz.no_requests")} hint={t("biz.no_requests_hint")} action={<Link href="/business/requests/new" aria-disabled={blocked} tabIndex={blocked ? -1 : undefined}><Button disabled={blocked}>{t("nav.new_request")}</Button></Link>} /></div>
      ) : (
        <Table bare stack label={t("biz.recent")} head={[t("req.ref"), t("req.starts"), t("req.slots"), t("common.status")]}>
          {items.map((x: any) => (
            <tr key={x.id} className={cn(needIds.has(x.id) && "bg-gold/5")}>
              <Td label={t("req.ref")}><CellPair href={`/business/requests/${x.id}`} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={t(`svc.${x.service}`)} /></Td>
              <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDateTime(x.startsAt, locale)}</Td>
              <Td label={t("req.slots")}><span className="ltr-num tabular-nums">{x.slotsFilled}/{x.quantity}</span>{parcelsOf(x) != null && <span className="block text-xs text-muted">{t("bs.parcels_n", { n: fmtNum(parcelsOf(x), locale) })}</span>}</Td>
              <Td label={t("common.status")}><span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={x.status} />{needIds.has(x.id) && <Badge tone="warn">{t("ubz.action_badge")}</Badge>}</span></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

export interface QuickLink { key: string; href: string; icon: ReactNode; label: string; hint?: string; disabled?: boolean }
/** Shortcuts to the jobs the owner does most. */
export function QuickActions({ links }: { links: QuickLink[] }) {
  const { t } = useI18n();
  return (
    <Section title={t("rdz.quick_title")} flush>
      <ul className="divide-y divide-line" data-testid="dash-quick">
        {links.map((l) => (
          <li key={l.key}>
            <Link href={l.href} aria-disabled={l.disabled} tabIndex={l.disabled ? -1 : undefined} className={cn("flex items-center gap-3 px-5 py-3 text-sm transition hover:bg-bg2/60", l.disabled && "pointer-events-none opacity-50")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden>{l.icon}</span>
              <span className="min-w-0 flex-1"><span className="block font-medium">{l.label}</span>{l.hint && <span className="block truncate text-xs text-muted">{l.hint}</span>}</span>
              <ChevronRight className="size-4 shrink-0 text-muted rtl:rotate-180" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Verification, warehouse pin and rating at a glance. */
export function AccountHealth({ status, warehouseSet, rating, geofence }: { status: string; warehouseSet: boolean | null; rating: number | null; geofence: boolean }) {
  const { t } = useI18n();
  const row = (label: string, value: ReactNode, href: string) => (
    <li><Link href={href} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-bg2/60"><span className="text-muted">{label}</span><span className="flex items-center gap-2 font-medium">{value}<ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden /></span></Link></li>
  );
  return (
    <Section title={t("rdz.account_title")} flush>
      <ul className="divide-y divide-line" data-testid="dash-account">
        {row(t("verify.title"), <StatusBadge status={status} />, "/business/documents")}
        {warehouseSet !== null && geofence && row(t("fob.wh_title"), <Badge tone={warehouseSet ? "success" : "warn"}>{t(warehouseSet ? "fob.wh_state_set" : "fob.wh_state_missing")}</Badge>, "/business/profile#warehouse")}
        {rating != null && row(t("rdz.rating"), <span className="ltr-num">★ {rating}</span>, "/business/requests?status=completed")}
      </ul>
    </Section>
  );
}

/** A brand-new account gets a short checklist instead of an empty dashboard. */
export interface Step { done: boolean; title: string; hint: string; href: string; cta: string; disabled?: boolean }
export function Checklist({ steps }: { steps: Step[] }) {
  const { t } = useI18n();
  const next = steps.findIndex((s) => !s.done);
  return (
    <Section title={t("ubz.start_title")} description={t("ubz.start_sub")} className="mb-6">
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className={cn("flex flex-col gap-2 rounded-xl border p-4", s.done ? "border-accent/40 bg-accent/5" : i === next ? "border-cyan/40 bg-cyan/5" : "border-line")}>
            <div className="flex items-center gap-2 font-medium">{s.done ? <CircleCheck className="size-5 text-accent" aria-hidden /> : <Circle className="size-5 text-muted" aria-hidden />}<span>{i + 1}. {s.title}</span>{s.done && <span className="sr-only">{t("ubz.step_done")}</span>}</div>
            <p className="text-xs text-muted">{s.hint}</p>
            {!s.done && <Link href={s.href} className="mt-auto" aria-disabled={s.disabled} tabIndex={s.disabled ? -1 : undefined}><Button size="sm" variant={i === next ? "primary" : "secondary"} disabled={s.disabled}>{s.cta}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Button></Link>}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export const ICONS = { attendance: BellRing, warehouse: MapPin, cash: HandCoins, returns: PackageX, drafts: FileEdit, wallet: Wallet, verify: ShieldAlert, order: FilePlus2, docs: FileText, plug: Plug, coins: Coins, delivered: PackageCheck };
