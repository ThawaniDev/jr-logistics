"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, UserCheck, WalletCards } from "lucide-react";
import { Avatar, Badge, Breadcrumbs, Button, Checkbox, DetailHeader, ErrorState, Notice, PageLoading, Section, Select, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, patch, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { hasAny } from "./admin-common";
import { EvidenceView, RespondentsView, SettlementPanel, type Evidence, type Respondents, type SettlementInfo } from "./admin-complaint-parts";
import { EntityLink, RoleBadge, UrgentBadge, statusNote } from "./admin-system-common";
import { refreshCases, useAssignees } from "./admin-system-data";
import { PersonCardView, RelatedCardsView, StaffLink, type PersonCard, type Related } from "./admin-ticket-cards";
import { HandlingHistory, OutcomeStats, SimilarCases, type Milestones, type Outcomes } from "./admin-ticket-history";
import { SlaClocks } from "./admin-ticket-sla";
import type { HistoryItem } from "@/server/details-pure";

const NEXT: Record<string, string[]> = { open: ["in_progress", "resolved"], in_progress: ["resolved"], resolved: ["closed", "in_progress"], closed: [] };
interface Context {
  filer: PersonCard | null; respondents: Respondents; related: Related; evidence: Evidence | null; evidenceHidden: boolean; settlement: SettlementInfo | null; history: HistoryItem[]; milestones: Milestones; outcomes: Outcomes;
  similar: Array<{ id: string; ref: string; status: string; createdAt: string | null; resolution: string | null; holdsSettlement: boolean; filer: string }>;
}

/** One complaint as its own view (`/admin/complaints/:id`): the report, SLA clocks, parties, related cards, evidence, the settlement it holds, its notes timeline with a note box, handling history, the handling panel (handler, payment hold, resolution, status), similar complaints, activity, internal notes and raw data. */
export function ComplaintDetail({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const allowed = hasPerm(me, "complaints.manage");
  const { data, error, mutate } = useApi(allowed ? `/complaints/${id}` : null, { refreshInterval: 30000, shouldRetryOnError: false });
  const ctx = useApi<Context>(allowed ? `/admin/complaints/${id}/context` : null, { refreshInterval: 60000, shouldRetryOnError: false });
  const people = useAssignees("complaints");
  const [res, setRes] = useState(""); const [note, setNote] = useState(""); const [assignee, setAssignee] = useState("");
  const crumbs = (last?: string) => [{ label: t("nav.complaints"), href: "/admin/complaints" }, ...(last ? [{ label: last }] : [])];
  if (!allowed) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  if (error && !data) return <><Breadcrumbs items={crumbs()} /><ErrorState error={error} retry={() => mutate()} /><div className="mt-4"><Link href="/admin/complaints" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t("nav.complaints")}</Link></div></>;
  if (!data) return <PageLoading />;

  const c = data.complaint; const notes: any[] = data.notes ?? []; const x = ctx.data;
  // resolving a complaint releases its hold; remember that one was in force so the panel can say "the hold ended" instead of "no hold"
  const lastHold = [...notes].reverse().find((n) => n.kind === "status" && (n.body === "settlement hold on" || n.body === "settlement hold off"));
  const heldAtClose = ["resolved", "closed"].includes(c.status) && lastHold?.body === "settlement hold on";
  const closed = c.status === "closed"; const mine = c.handlerId === me.id;
  const refresh = () => { void mutate(); void refreshCases(); };
  const upd = (body: unknown) => a.run("u", () => patch(`/admin/complaints/${id}`, body), { success: "common.saved", onDone: refresh });
  const addNote = () => a.run("n", () => post(`/complaints/${id}/notes`, { body: note.trim() }), { success: "common.saved", onDone: () => { setNote(""); refresh(); } });
  const filer = x?.filer?.name ?? null;
  const handlerName = c.handlerId ? people.nameOf(c.handlerId) ?? x?.milestones.handler?.name ?? null : null;
  const text = (n: any) => n.kind === "assign" ? t("adm.assigned_to", { name: n.body }) : n.kind === "status" ? (n.body === "settlement hold on" ? t("rdb.cmp_hold_on") : n.body === "settlement hold off" ? t("rdb.cmp_hold_off") : statusNote(n.body, t)) : n.body;
  const next = NEXT[c.status] ?? [];
  const needsRes = next.some((s) => s === "resolved" || s === "closed");
  const category = t(`complaint_cat.${c.category}`);

  return (
    <>
      <Breadcrumbs items={crumbs(c.ref)} />
      <DetailHeader name={category} avatar={<Avatar name={filer ?? t(`role.${c.filedByRole}`)} size={56} />} subtitle={<span className="ltr-num">{c.ref}</span>}
        badges={<span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={c.status} />{c.priority === "urgent" && <UrgentBadge />}{c.holdsSettlement && <Badge tone="warn"><WalletCards className="size-3" aria-hidden />{t("complaints.holds_settlement")}</Badge>}</span>}
        facts={[
          { label: t("rdb.cmp_filed_by"), value: <span className="inline-flex flex-wrap items-center gap-1.5"><EntityLink role={c.filedByRole} id={c.filedBy} testid="complaints-filer-link">{filer ?? t(`role.${c.filedByRole}`)}</EntityLink><RoleBadge role={c.filedByRole} /></span> },
          { label: t("adm.handler"), value: c.handlerId ? <StaffLink id={c.handlerId} testId="dv3-handler-link">{mine ? t("foa.case_assigned_you") : handlerName ?? t("adm.assigned")}</StaffLink> : <span className="text-muted">{t("adm.unassigned")}</span> },
          { label: t("common.date"), value: fmtDateTime(c.createdAt, locale) },
          { label: t("foa.case_linked"), value: c.requestId && hasAny(me, "requests.view") ? <Link href={`/admin/requests/${c.requestId}`} data-testid="complaints-request-link" className="inline-flex items-center gap-1 text-accent hover:underline">{t("adm.open_request")}<ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden /></Link> : "—" },
        ]}
        actions={!closed && !mine && <Button data-testid="complaints-take" variant="secondary" loading={a.is("u")} onClick={() => upd({ assignToMe: true })}><UserCheck className="size-4" aria-hidden />{c.handlerId ? t("adm.take_over") : t("complaints.take")}</Button>} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Section title={t("rdb.cmp_report")}>
            <p dir="auto" className="whitespace-pre-wrap break-words rounded-xl bg-bg2 p-3 text-sm" data-testid="complaints-description">{c.description}</p>
            {c.resolution && <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm" data-testid="complaints-resolution"><p className="mb-1 font-semibold text-accent">{t("support.resolution")}</p><p className="whitespace-pre-wrap break-words">{c.resolution}</p></div>}
          </Section>
          <Section title={t("rdb.cmp_activity")} description={t("rdb.cmp_activity_hint")}>
            {notes.length === 0 ? <p className="text-sm text-muted">{t("rdb.cmp_no_activity")}</p> : (
              <ol className="relative space-y-4 border-s border-line ps-5" aria-label={t("adm.notes")} data-testid="complaints-notes">
                {notes.map((n) => (
                  <li key={n.id} className="relative">
                    <span className={cn("absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-card", n.kind === "note" ? "bg-accent" : "bg-muted/60")} aria-hidden />
                    <p dir={n.kind === "note" ? "auto" : undefined} className={cn("text-sm", n.kind === "note" ? "rounded-xl bg-bg2 p-3" : "text-muted")}>{text(n)}</p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-muted">{n.kind === "note" && <RoleBadge role={n.authorRole} />}{fmtDateTime(n.createdAt, locale)}</p>
                  </li>))}
              </ol>)}
            {!closed && (
              <div className="mt-5 space-y-2 border-t border-line pt-4">
                <Textarea data-testid="complaints-note" label={t("adm.add_note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                <div className="flex justify-end"><Button data-testid="complaints-add-note" size="sm" variant="secondary" loading={a.is("n")} disabled={!note.trim()} onClick={addNote}>{t("adm.add_note")}</Button></div>
              </div>)}
          </Section>
          {x && <EvidenceView e={x.evidence} hidden={x.evidenceHidden} />}
          {x && <HandlingHistory history={x.history} ms={x.milestones} kind="complaint" />}
          <ActivityLog entity="complaint" id={id} />
          <NotesPanel entity="complaint" id={id} />
          <RawDataPanel data={c} testId="dv3-raw" />
        </div>

        <div className="min-w-0 space-y-5">
          <SlaClocks row={{ createdAt: c.createdAt, firstResponseAt: c.firstResponseAt ?? null, resolvedAt: c.resolvedAt ?? null }} />
          {closed ? <Notice tone="info">{t("rdb.cmp_closed_note")}</Notice> : (
            <Section title={t("rdb.cd_handling")}>
              <div className="space-y-4">
                {people.canList && people.people.length > 0 && (
                  <div className="space-y-2">
                    <Select data-testid="complaints-assignee" label={t("adm.assign_to")} placeholder={t("common.select")} value={assignee} onChange={(e) => setAssignee(e.target.value)}
                      options={people.people.filter((s) => s.id !== c.handlerId).map((s) => ({ value: s.id, label: s.name }))} />
                    <Button data-testid="complaints-assign" size="sm" loading={a.is("u")} disabled={!assignee} onClick={() => { void upd({ assignTo: assignee }); setAssignee(""); }}>{t("adm.assign")}</Button>
                  </div>)}
                {c.status !== "resolved" && <Checkbox data-testid="complaints-hold" checked={!!c.holdsSettlement} disabled={a.is("u")} onChange={(e) => upd({ holdsSettlement: e.target.checked })} label={<><span className="font-medium text-ink">{t("adm.hold_settlement")}</span><span className="mt-0.5 block text-xs text-muted">{t("rdb.cmp_hold_hint")}</span></>} />}
              </div>
            </Section>)}
          {next.length > 0 && (
            <Section title={t("rdb.cmp_status_title")}>
              <div className="space-y-3">
                {needsRes && <Textarea data-testid="complaints-resolution-input" label={t("support.resolution")} value={res} onChange={(e) => setRes(e.target.value)} maxLength={1000} hint={c.resolution ? undefined : t("rdb.cmp_resolution_hint")} />}
                <div className="flex flex-wrap gap-2">{next.map((s) => (
                  <Button key={s} data-testid={`complaints-to-${s}`} size="sm" variant={s === "resolved" ? "primary" : "secondary"} loading={a.any} disabled={["resolved", "closed"].includes(s) && !res.trim() && !c.resolution}
                    onClick={() => upd({ status: s, resolution: res || undefined })}>{t(`complaints.to_${s}`)}</Button>))}</div>
              </div>
            </Section>)}
          {x && <PersonCardView p={x.filer} title={t("dv3.cp_filer")} testId="dv3-filer" />}
          {x && <RespondentsView r={x.respondents} />}
          {x && <SettlementPanel s={x.settlement} holds={!!c.holdsSettlement || heldAtClose} />}
          {x && <RelatedCardsView r={x.related} />}
          {x && <OutcomeStats o={x.outcomes} category={category} />}
          {x && <SimilarCases kind="complaint" items={x.similar} />}
          {ctx.error && !x && <Notice tone="warn">{t("dv3.ctx_failed")}</Notice>}
        </div>
      </div>
    </>
  );
}
