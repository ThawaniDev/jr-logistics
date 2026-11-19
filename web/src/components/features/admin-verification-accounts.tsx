"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, MessageSquareWarning, ShieldCheck, XCircle } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, Notice, PageLoading, SearchBox, Segmented, StatusBadge, Table, Td, Toolbar, useAction } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { ApiError, post } from "@/lib/api";
import { fmtDate, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ReasonModal, fullErr, hasAny, useTx } from "./admin-common";
import { IconAction } from "./admin-verification-parts";
import { ownerHref } from "./admin-companies-lib";
import { useRefreshCompanies } from "./admin-companies-ctx";

interface Row { key: string; kind: "business" | "office"; id: string; name: string; sub?: string; cr: string | null; status: string; createdAt: string }
type Ask = { row: Row; action: "request_info" | "reject" };

/** Accounts queue: companies and courier offices waiting for a verification decision. Quick decisions here, the full review lives in the entity's detail view. */
export function VerificationAccounts() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction(); const tx = useTx(); const refresh = useRefreshCompanies();
  const [kind, setKind] = useUrlState("kind", "all"); const [q, setQ] = useState(""); const [ask, setAsk] = useState<Ask | null>(null); const [err, setErr] = useState<string | null>(null);
  const { data, error, mutate } = useApi("/admin/verification-queue");
  const can = (p: string) => hasPerm(me, p); const canAct = hasAny(me, "verification.manage", "offices.manage");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const all: Row[] = [
    ...data.business.map((b: any): Row => ({ key: `b${b.id}`, kind: "business", id: b.id, name: b.company ?? b.name, sub: b.company ? b.name : undefined, cr: b.cr, status: b.status, createdAt: b.createdAt })),
    ...data.offices.map((b: any): Row => ({ key: `o${b.id}`, kind: "office", id: b.id, name: b.name, cr: b.cr, status: b.status, createdAt: b.createdAt })),
  ].sort((x, y) => +new Date(x.createdAt) - +new Date(y.createdAt));
  const k = kind === "business" || kind === "office" ? kind : "all"; const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => (k === "all" || r.kind === k) && (!needle || [r.name, r.sub, r.cr].some((v) => v?.toLowerCase().includes(needle))));
  const nb = data.business.length, no = data.offices.length;
  const done = () => { setAsk(null); refresh(); mutate(); };
  const fail = (e: unknown) => {
    const missing = e instanceof ApiError && Array.isArray(e.details.missing) ? (e.details.missing as string[]) : null;
    setErr(missing ? t("rdp.docs_missing", { docs: missing.map((d) => tx(`doc.${d}`, d)).join(", ") }) : fullErr(e, t));
  };
  const approve = (r: Row) => { setErr(null); return a.run(`v${r.key}`, () => post(`/admin/users/${r.id}/verification`, { action: "verify" }), { success: "common.saved", onDone: done, onError: fail }); };
  const submit = (note: string) => ask && a.run("ask", () => post(`/admin/users/${ask.row.id}/verification`, { action: ask.action, note }), { success: "common.saved", onDone: done, onError: fail });
  return (
    <>
      <Toolbar end={<span className="text-sm text-muted" aria-live="polite">{t("rdp.vf_waiting", { n: fmtNum(rows.length, locale) })}</span>}>
        <SearchBox value={q} onChange={setQ} placeholder={t("rdp.vf_search")} label={t("rdp.vf_search")} />
        <Segmented label={t("rdp.vf_kind")} value={k} onChange={setKind}
          options={[{ key: "all", label: t("common.all"), count: nb + no }, { key: "business", label: t("rdp.vf_companies_short"), count: nb }, { key: "office", label: t("nav.offices"), count: no }]} />
      </Toolbar>
      {err && <div className="mb-4"><Notice tone="danger">{err}</Notice></div>}
      {rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-9" aria-hidden />} title={nb + no === 0 ? t("verify.nothing") : t("common.no_results")} hint={nb + no === 0 ? t("rdp.vf_nothing_hint") : t("ubz.no_results_hint")}
          action={nb + no === 0 ? <Link href="/admin/companies"><Button variant="secondary">{t("nav.companies")}</Button></Link> : <Button variant="secondary" onClick={() => { setQ(""); setKind("all"); }}>{t("uxa.clear_filters")}</Button>} />
      ) : (
        <Table stack label={t("rdp.vf_accounts")} head={[t("common.name"), t("rdp.col_cr"), t("common.status"), t("rdp.vf_waiting_since"), { label: t("rdp.col_actions"), align: "end" }]}>
          {rows.map((r) => { const href = ownerHref(r.kind, r.id, can); return (
            <tr key={r.key} data-testid="verification-account-row">
              <Td label={t("common.name")} className="max-w-[18rem]"><CellPair href={href ?? undefined} title={r.name} sub={<><Badge tone={r.kind === "business" ? "info" : "neutral"} className="me-1.5 py-0 text-[11px]">{t(`role.${r.kind}`)}</Badge>{r.sub}</>} /></Td>
              <Td label={t("rdp.col_cr")} className="ltr-num text-muted">{r.cr ?? "—"}</Td>
              <Td label={t("common.status")}><StatusBadge status={r.status} /></Td>
              <Td label={t("rdp.vf_waiting_since")} className="whitespace-nowrap text-muted">{fmtDate(r.createdAt, locale)}</Td>
              <Td align="end"><div className="flex items-center justify-end gap-1.5">
                {href && <Link href={href} data-testid="verification-account-open"><Button size="sm" variant="secondary">{t("adm.review")}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Button></Link>}
                {canAct && <>
                  <Button size="sm" data-testid="verification-account-approve" loading={a.is(`v${r.key}`)} onClick={() => approve(r)}><CheckCircle2 className="size-4" aria-hidden />{t("verify.approve")}</Button>
                  {r.status !== "info_requested" && <IconAction label={t("verify.request_info")} variant="gold" testId="verification-account-info" onClick={() => { setErr(null); setAsk({ row: r, action: "request_info" }); }}><MessageSquareWarning className="size-4" aria-hidden /></IconAction>}
                  <IconAction label={t("verify.reject")} variant="danger" testId="verification-account-reject" onClick={() => { setErr(null); setAsk({ row: r, action: "reject" }); }}><XCircle className="size-4" aria-hidden /></IconAction>
                </>}
              </div></Td>
            </tr>); })}
        </Table>)}
      <ReasonModal open={!!ask} onClose={() => setAsk(null)} danger={ask?.action === "reject"} busy={a.is("ask")} onSubmit={submit}
        title={ask ? `${t(ask.action === "reject" ? "verify.reject" : "verify.request_info")} · ${ask.row.name}` : ""} confirmLabel={ask ? t(ask.action === "reject" ? "verify.reject" : "verify.request_info") : undefined}
        label={t("verify.note")} hint={t("verify.note_hint")} />
    </>
  );
}
