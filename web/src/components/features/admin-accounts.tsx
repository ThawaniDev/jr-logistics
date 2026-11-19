"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge, Button, ErrorState, KV, Modal, Notice, PageLoading, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { fullErr, hasAny } from "./admin-common";
import { WarehouseOpsPanel } from "./admin-warehouse";

const ACTIONS = [
  { action: "verify", label: "verify.approve", variant: "primary" as const, note: false },
  { action: "request_info", label: "verify.request_info", variant: "gold" as const, note: true },
  { action: "reject", label: "verify.reject", variant: "danger" as const, note: true },
  { action: "suspend", label: "admin.suspend", variant: "danger" as const, note: true },
];

/** Account-level verification actions (business / office) with a required note where the API demands one. */
export function AccountActions({ userId, status, onDone }: { userId: string; status?: string; onDone: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const [pending, setPending] = useState<null | (typeof ACTIONS)[number]>(null); const [note, setNote] = useState(""); const [err, setErr] = useState<string | null>(null);
  if (!hasAny(me, "verification.manage", "offices.manage")) return null;
  const submit = (x: (typeof ACTIONS)[number]) => a.run("acct", () => post(`/admin/users/${userId}/verification`, { action: x.action, note: note.trim() || undefined }), {
    success: "common.saved", onDone: () => { setPending(null); setNote(""); setErr(null); onDone(); }, onError: (e) => setErr(fullErr(e, t)),
  });
  const visible = ACTIONS.filter((x) => !(x.action === "verify" && status === "verified") && !(x.action === "suspend" && status === "suspended"));
  return (
    <div className="space-y-3">
      {!pending ? (
        <div className="flex flex-wrap gap-2">{visible.map((x) => <Button key={x.action} size="sm" variant={x.variant} loading={a.is("acct")} onClick={() => { if (!x.note) { submit(x); return; } setPending(x); setErr(null); }}>{t(x.label)}</Button>)}</div>
      ) : (
        <div className="space-y-2">
          <Textarea label={t("verify.note")} hint={t("verify.note_hint")} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setPending(null)}>{t("common.cancel")}</Button><Button size="sm" variant={pending.variant} loading={a.is("acct")} disabled={!note.trim()} onClick={() => submit(pending)}>{t(pending.label)}</Button></div>
        </div>)}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Detail + re-review modal for a business or office account. */
export function AccountModal({ userId, onClose, onChanged }: { userId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n(); const me = useUser();
  const { data, error, mutate } = useApi(userId ? `/admin/users/${userId}` : null, { shouldRetryOnError: false });
  const isOffice = data?.user?.role === "office";
  const agr = useApi(userId && isOffice && hasAny(me, "offices.view") ? `/admin/offices/${userId}/agreements` : null, { shouldRetryOnError: false });
  // The documents endpoint filters by owner, so this is the owner's own newest 50 (not a client-side cut of everybody's).
  const docs = useApi(userId && data?.user && hasAny(me, "documents.review", "verification.manage") ? `/admin/documents?kind=${data.user.role}&ownerId=${userId}` : null, { shouldRetryOnError: false });
  const ownDocs: any[] = docs.data?.items ?? [];
  const p = data?.profile; const u = data?.user;
  const full = u?.role === "business" ? `/admin/companies/${u.id}` : u?.role === "office" ? `/admin/offices/${u.id}` : null;
  return (
    <Modal open={!!userId} onClose={onClose} title={u ? (p?.companyName ?? p?.officeName ?? u.name) : t("verify.title")} footer={<>{full && <Link href={full} data-testid="account-open-full" className="me-auto"><Button variant="secondary">{t("rdp.open_full_view")}<ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden /></Button></Link>}<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button></>}>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : <>
        <dl>
          <KV label={t("common.role")}>{t(`role.${u.role}`)}</KV>
          <KV label={t("auth.phone")}><span className="ltr-num">{u.phone ?? "—"}</span></KV>
          <KV label={t("reg.cr")}><span className="ltr-num">{p?.crNumber ?? "—"}</span></KV>
          <KV label={t("reg.address")}>{p?.address ?? "—"}</KV>
          <KV label={t("verify.title")}>{p?.verificationStatus ? <StatusBadge status={p.verificationStatus} /> : "—"}</KV>
          <KV label={t("common.status")}><StatusBadge status={u.status} /></KV>
        </dl>
        {p?.verificationNote && <Notice tone="info" title={t("verify.note")}>{p.verificationNote}</Notice>}
        {isOffice && agr.data && (
          <div><h3 className="mb-1 text-sm font-semibold">{t("nav.agreement")}</h3>
            {agr.data.items.length === 0 ? <p className="text-sm text-muted">{t("office.no_agreement")}</p> : (
              <ul className="space-y-1 text-sm">{agr.data.items.map((g: any) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2"><span>{t("office.agreement_v", { v: g.version })}</span><Badge tone={g.status === "accepted" ? "success" : g.status === "pending_acceptance" ? "warn" : "neutral"}>{g.status === "accepted" ? t("adm.agr_accepted") : g.status === "pending_acceptance" ? t("adm.agr_pending") : t("adm.agr_superseded")}</Badge>
                  {g.acceptedAt && <span className="text-xs text-muted">{t("office.accepted_on", { d: fmtDate(g.acceptedAt, locale) })}</span>}{g.expiresAt && <span className="text-xs text-muted">{t("docs.expires")} {fmtDate(g.expiresAt, locale)}</span>}</li>))}</ul>)}
          </div>)}
        {docs.data && (
          <div><h3 className="mb-1 text-sm font-semibold">{t("verify.documents")}</h3>
            {ownDocs.length === 0 ? <p className="text-sm text-muted">{t("adm.no_docs_found")}</p> : (
              <ul className="space-y-1 text-sm">{ownDocs.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2"><span>{t(`doc.${d.type}`)}</span><StatusBadge status={d.status} />{d.expiresOn && <span className="text-xs text-muted">{t("docs.expires")} {fmtDate(d.expiresOn, locale)}</span>}</li>)}</ul>)}
          </div>)}
        {u.role === "business" && hasAny(me, "users.view", "users.edit") && (
          <div data-testid="foa-wh-section"><h3 className="mb-2 text-sm font-semibold">{t("foa.wh_title")}</h3><WarehouseOpsPanel key={u.id} businessId={u.id} embedded /></div>)}
        <AccountActions key={u.id} userId={u.id} status={p?.verificationStatus} onDone={() => { mutate(); onChanged(); }} />
      </>}
    </Modal>
  );
}
