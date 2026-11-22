"use client";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ExternalLink, ImageIcon, RotateCcw, UserCheck } from "lucide-react";
import { Avatar, Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, KV, Notice, PageLoading, Section, Select, StatusBadge, useAction, NoAccess } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { hasAny } from "./admin-common";
import { ticketPatch } from "./admin-fieldops-lib";
import { AttachmentView, CaseMessage, CaseReplyBox, type Attachment } from "./admin-system-case-parts";
import { EntityLink, RoleBadge, UrgentBadge } from "./admin-system-common";
import { refreshCases, useAssignees } from "./admin-system-data";
import { PersonCardView, RelatedCardsView, StaffLink, type PersonCard, type Related } from "./admin-ticket-cards";
import { HandlingHistory, OutcomeStats, SimilarCases, type Milestones, type Outcomes } from "./admin-ticket-history";
import { SlaClocks } from "./admin-ticket-sla";
import type { HistoryItem } from "@/server/details-pure";

const STATUSES = ["open", "in_review", "resolved"] as const;
interface Context { requester: PersonCard | null; related: Related; history: HistoryItem[]; milestones: Milestones; outcomes: Outcomes; sameCategory: Array<{ id: string; ref: string; subject: string; status: string; createdAt: string; opener: string }> }

/** Every file of the conversation in one place, newest message last, so evidence is not buried inside a long thread. */
function Gallery({ replies }: { replies: Array<{ id: string; authorName?: string | null; createdAt: string; attachments?: Attachment[] }> }) {
  const { t, locale } = useI18n();
  const files = replies.flatMap((r) => (r.attachments ?? []).map((a) => ({ a, by: r.authorName, at: r.createdAt })));
  if (files.length === 0) return null;
  return (
    <Section title={<span className="inline-flex items-center gap-2"><ImageIcon className="size-4 text-muted" aria-hidden />{t("dv3.tk_gallery")}</span>} description={t("dv3.tk_gallery_sub", { n: files.length })}>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="dv3-gallery">
        {files.map(({ a, by, at }) => <li key={a.id} className="min-w-0"><AttachmentView a={a} /><p className="mt-1 truncate text-[11px] text-muted">{by ?? "—"} · <span>{fmtDateTime(at, locale)}</span></p></li>)}
      </ul>
    </Section>
  );
}

/** One support ticket as its own view (`/admin/cases/:id`): header with facts and the main actions, SLA clocks, the conversation with canned replies, the handling history, requester and related cards, similar cases, activity, notes and raw data. */
export function CaseDetail({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const canView = hasPerm(me, "tickets.view"); const canManage = hasPerm(me, "tickets.manage");
  const { data, error, mutate } = useApi(canView ? `/admin/tickets/${id}` : null, { refreshInterval: 20000, shouldRetryOnError: false });
  const ctx = useApi<Context>(canView ? `/admin/tickets/${id}/context` : null, { refreshInterval: 60000, shouldRetryOnError: false });
  const people = useAssignees("tickets");
  const crumbs = (last?: string) => [{ label: t("nav.cases"), href: "/admin/cases" }, ...(last ? [{ label: last }] : [])];
  if (!canView) return <NoAccess />;
  if (error && !data) return <><Breadcrumbs items={crumbs()} /><ErrorState error={error} retry={() => mutate()} /><div className="mt-4"><Link href="/admin/cases" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t("nav.cases")}</Link></div></>;
  if (!data) return <PageLoading />;

  const tk = data.ticket; const replies: any[] = data.replies ?? [];
  const resolved = tk.status === "resolved"; const c = ctx.data;
  const refresh = () => { void mutate(); void refreshCases(); };
  const apply = (change: Parameters<typeof ticketPatch>[1]) => {
    const body = ticketPatch(tk, change); if (!body) return;
    return a.run("p", () => patch(`/admin/tickets/${id}`, body), { success: "common.saved", onDone: refresh });
  };
  const assignedName = tk.assigneeName ?? people.nameOf(tk.assignedTo);
  const assignOptions = [{ value: "", label: t("foa.case_unassigned") }, ...people.people.map((x) => ({ value: x.id, label: x.name })),
    ...(tk.assignedTo && !people.people.some((x) => x.id === tk.assignedTo) ? [{ value: tk.assignedTo as string, label: assignedName ?? t("foa.case_assigned_other") }] : [])];
  const mine = tk.assignedTo === me.id;
  const category = t(`ticket_cat.${tk.category}`);

  return (
    <>
      <Breadcrumbs items={crumbs(tk.ref)} />
      <DetailHeader name={tk.subject} avatar={<Avatar name={tk.openedByName ?? tk.subject} size={56} />} subtitle={<span className="inline-flex flex-wrap items-center gap-x-2"><span className="ltr-num">{tk.ref}</span><span aria-hidden>·</span>{category}</span>}
        badges={<span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={tk.status} />{tk.priority === "urgent" && <UrgentBadge />}{tk.reopenCount > 0 && <Badge tone="warn">{t("dv3.tk_reopened", { n: tk.reopenCount })}</Badge>}</span>}
        facts={[
          { label: t("foa.case_opener"), value: <span className="inline-flex flex-wrap items-center gap-1.5"><EntityLink role={tk.openedByRole} id={tk.openedBy} testid="rdb-case-opener-link">{tk.openedByName ?? "—"}</EntityLink><RoleBadge role={tk.openedByRole} /></span> },
          { label: t("foa.case_assignee"), value: tk.assignedTo ? <StaffLink id={tk.assignedTo} testId="dv3-assignee-link">{mine ? t("foa.case_assigned_you") : assignedName ?? t("foa.case_assigned_other")}</StaffLink> : <span className="text-muted">{t("adm.unassigned")}</span> },
          { label: t("common.date"), value: fmtDateTime(tk.createdAt, locale) },
          { label: t("rdb.cd_last_update"), value: fmtDateTime(tk.updatedAt, locale) },
        ]}
        actions={canManage && <>
          {!mine && !resolved && <Button data-testid="foa-case-assign-me" variant="secondary" disabled={a.is("p")} onClick={() => apply({ assignToMe: true })}><UserCheck className="size-4" aria-hidden />{t("foa.case_assign_me")}</Button>}
          {resolved
            ? <Button data-testid="rdb-case-reopen" variant="secondary" loading={a.is("p")} onClick={() => apply({ status: "in_review" })}><RotateCcw className="size-4" aria-hidden />{t("fob.reopen")}</Button>
            : <Button data-testid="foa-case-resolve" loading={a.is("p")} onClick={() => apply({ status: "resolved" })}><CheckCircle2 className="size-4" aria-hidden />{t("cases.resolve")}</Button>}
        </>} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Section title={t("rdb.cd_conversation")} description={t("rdb.cd_conversation_hint", { n: replies.length })}>
            <ol className="space-y-3" data-testid="foa-case-thread" aria-live="polite" aria-label={t("fob.messages")}>
              {replies.map((r) => <CaseMessage key={r.id} r={r} fallbackName={tk.openedByName} />)}
            </ol>
            {replies.length === 0 && <EmptyState title={t("uxa.no_replies")} />}
            <div className="mt-5 border-t border-line pt-4">
              {canManage && !resolved && <CaseReplyBox id={id} onSent={refresh} category={tk.category} requesterName={tk.openedByName} refNo={tk.ref} />}
              {canManage && resolved && <Notice tone="info">{t("foa.case_resolved_note")}</Notice>}
              {!canManage && <Notice tone="info">{t("foa.case_readonly")}</Notice>}
            </div>
          </Section>
          <Gallery replies={replies} />
          {c && <HandlingHistory history={c.history} ms={c.milestones} kind="ticket" />}
          <ActivityLog entity="ticket" id={id} />
          <NotesPanel entity="ticket" id={id} />
          <RawDataPanel data={tk} testId="dv3-raw" />
        </div>

        <div className="min-w-0 space-y-5">
          <SlaClocks row={{ createdAt: tk.createdAt, firstResponseAt: tk.firstResponseAt ?? null, resolvedAt: tk.resolvedAt ?? null }} />
          {canManage && (
            <Section title={t("rdb.cd_handling")}>
              <div className="space-y-4" data-testid="foa-case-controls">
                <Select data-testid="foa-case-status" label={t("common.status")} value={tk.status} disabled={a.is("p")} onChange={(e) => apply({ status: e.target.value })} options={STATUSES.map((k) => ({ value: k, label: t(`status.${k}`) }))} />
                <Select data-testid="foa-case-priority" label={t("foa.case_priority")} value={tk.priority ?? "normal"} disabled={a.is("p")} onChange={(e) => apply({ priority: e.target.value })} options={[{ value: "normal", label: t("foa.case_priority_normal") }, { value: "urgent", label: t("support.urgent") }]} />
                <Select data-testid="foa-case-assign" label={t("foa.case_assignee")} value={tk.assignedTo ?? ""} disabled={a.is("p")} onChange={(e) => apply({ assignedTo: e.target.value })} options={assignOptions}
                  hint={people.error ? t("foa.case_assignees_failed") : assignedName ? t("foa.case_assigned_to", { name: assignedName }) : undefined} />
              </div>
            </Section>)}
          <Section title={t("rdb.cd_details")}>
            <dl data-testid="foa-case-facts">
              <KV label={t("foa.case_ref")}><span className="ltr-num">{tk.ref}</span></KV>
              <KV label={t("support.subject")}><span dir="auto">{tk.subject}</span></KV>
              <KV label={t("support.category")}>{category}</KV>
              <KV label={t("common.status")}><StatusBadge status={tk.status} /></KV>
              <KV label={t("foa.case_priority")}>{tk.priority === "urgent" ? <Badge tone="danger">{t("support.urgent")}</Badge> : t("foa.case_priority_normal")}</KV>
              {tk.resolvedAt && <KV label={t("rdb.cd_resolved_at")}>{fmtDateTime(tk.resolvedAt, locale)}</KV>}
              {(tk.requestId || tk.offerId) && <KV label={t("foa.case_linked")}>
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  {tk.requestId && (hasAny(me, "requests.view") ? <Link data-testid="foa-case-request-link" href={`/admin/requests/${tk.requestId}`} className="inline-flex items-center gap-1 text-accent hover:underline">{t("adm.open_request")}<ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden /></Link> : <span>{t("foa.case_linked_request")}</span>)}
                  {tk.offerId && <Badge tone="neutral">{t("foa.case_linked_offer")}</Badge>}
                </span></KV>}
            </dl>
          </Section>
          {c && <PersonCardView p={c.requester} title={t("dv3.tk_requester")} testId="dv3-requester" />}
          {c && <RelatedCardsView r={c.related} />}
          {c && <OutcomeStats o={c.outcomes} category={category} />}
          {c && <SimilarCases kind="ticket" items={c.sameCategory} />}
          {ctx.error && !c && <Notice tone="warn">{t("dv3.ctx_failed")}</Notice>}
        </div>
      </div>
    </>
  );
}
