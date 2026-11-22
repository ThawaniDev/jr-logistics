"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge, Button, Input, Modal, Notice, Textarea, errText, useAction } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { hasAny, qs } from "./admin-common";

type Kind = "noshow" | "loading" | "replace" | "end_route";

/**
 * Loading mode + scan progress and cash on delivery of one driver card (E.2 / E.6), plus the "Receive money" shortcut into /admin/finance/cod.
 * The legacy `qty_disputed` state gets a read-only badge only — the warehouse confirm / dispute step no longer exists (E16).
 */
export function OfferFieldOpsInfo({ offer, businessId }: { offer: any; businessId?: string }) {
  const { t, locale } = useI18n(); const me = useUser();
  const l = offer.loading as { mode?: string; assigned?: number; scanned?: number; finished?: boolean } | null | undefined;
  const c = offer.cod as { collectedCents?: number; receivedCents?: number; outstandingCents?: number } | null | undefined;
  const hasCod = !!c && ((c.collectedCents ?? 0) > 0 || (c.outstandingCents ?? 0) > 0 || (c.receivedCents ?? 0) > 0);
  const canManage = hasPerm(me, "cod.manage"); const canOpen = canManage || hasPerm(me, "finance.view");
  const link = `/admin/finance/cod${qs({ offerId: offer.id, businessId, driverId: offer.driver?.id })}`;
  if (!l && !hasCod && offer.status !== "qty_disputed") return null;
  const money = (n: number | undefined) => fmtMoney(n ?? 0, locale);
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-bg2/50 p-3 text-xs" data-testid={`foa-offer-info-${offer.id}`}>
      {l?.mode && (
        <p className="flex flex-wrap items-center gap-1.5 text-muted">
          <span className="font-medium text-ink">{t("foa.load_title")}</span>{t(l.mode === "driver_scan" ? "foa.load_mode_driver_scan" : "foa.load_mode_warehouse")}
          {l.mode === "driver_scan" && <span className="ltr-num" data-testid={`foa-offer-scan-${offer.id}`}>{t("foa.load_progress", { scanned: l.scanned ?? 0, assigned: l.assigned ?? 0 })}</span>}
          {l.finished && <Badge tone="success">{t("foa.load_finished")}</Badge>}
        </p>)}
      {hasCod && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted" data-testid={`foa-offer-cod-${offer.id}`}>
          <span className="font-medium text-ink">{t("foa.cod_title_short")}</span>
          <span>{t("foa.cod_collected")}: <b className="ltr-num text-ink">{money(c?.collectedCents)}</b></span>
          <span>{t("foa.cod_received")}: <b className="ltr-num text-ink">{money(c?.receivedCents)}</b></span>
          <span>{t("foa.cod_outstanding")}: <b className={`ltr-num ${(c?.outstandingCents ?? 0) > 0 ? "text-gold" : "text-ink"}`}>{money(c?.outstandingCents)}</b></span>
          {canOpen && <Link data-testid={`foa-offer-cod-link-${offer.id}`} href={link} className="text-accent hover:underline">{canManage && (c?.outstandingCents ?? 0) > 0 ? t("foa.cod_receive_row") : t("foa.cod_open_console")}</Link>}
        </p>)}
      {offer.status === "qty_disputed" && <p><Badge tone="danger">{t("foa.legacy_disputed")}</Badge> <span className="text-muted">{t("foa.legacy_disputed_hint")}</span></p>}
    </div>
  );
}

/**
 * Staff actions for one driver card. The API sends `actions: []` to staff, so the next steps are derived from the offer status
 * with the same rules as the business flow; the server still enforces permissions and state.
 */
export function OfferStaffActions({ offer, service, onDone }: { offer: any; service: string; onDone: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const [busy, setBusy] = useState<string | null>(null);
  const [m, setM] = useState<Kind | null>(null); const [units, setUnits] = useState(""); const [text, setText] = useState("");
  const [note, setNote] = useState(""); const [repErr, setRepErr] = useState<string | null>(null);
  const edit = hasAny(me, "requests.edit", "attendance.edit"); const replaceOk = hasPerm(me, "replacements.manage");
  const st = offer.status as string;
  const open = (k: Kind, u = "") => { setM(k); setUnits(u); setText(""); setNote(""); setRepErr(null); };
  const go = (key: string, path: string, body: unknown) => a.run(key, () => post(path, body), { success: "common.saved", onDone: () => { setM(null); onDone(); } });
  const id = offer.id as string;
  const btns: React.ReactNode[] = [];
  if (edit && ["accepted", "arrived"].includes(st)) {
    btns.push(<Button key="att" size="sm" loading={a.is("att")} onClick={() => go("att", `/offers/${id}/attendance`, { present: true })}>{t("adm.confirm_attendance")}</Button>);
    btns.push(<Button key="ns" size="sm" variant="danger" onClick={() => open("noshow")}>{t("adm.mark_no_show")}</Button>);
  }
  // With scan-based loading (E3) the driver records what goes on the vehicle; the manual hand-over only exists when the warehouse records it.
  if (edit && st === "attendance_confirmed" && service === "delivery_driver" && offer.loading?.mode !== "driver_scan") btns.push(<Button key="ld" size="sm" variant="secondary" onClick={() => open("loading", String(offer.loadedUnits ?? offer.expectedUnits ?? ""))}>{t("adm.record_loading")}</Button>);
  if (replaceOk && ["accepted", "arrived", "attendance_confirmed"].includes(st)) btns.push(<Button key="rp" size="sm" variant="danger" onClick={() => open("replace")}>{t("office.replace")}</Button>);
  // Driver breakdown / illness mid-route: delivered stops stay paid, parcels on board become returns.
  if (replaceOk && st === "attendance_confirmed" && offer.routeApprovedAt) btns.push(<Button key="er" size="sm" variant="danger" onClick={() => open("end_route")}>{t("shipadm.end_route")}</Button>);
  if (btns.length === 0) return null;
  const textOk = text.trim().length >= 3; const unitsOk = units !== "" && Number(units) >= 0 && Number.isInteger(Number(units));
  const close = () => setM(null);
  /** Replacement is refused once stops were worked (INVALID_TRANSITION details.resolvedStops): explain and point to End route. */
  const replace = async () => {
    setBusy("rp"); setRepErr(null);
    try { await post(`/admin/offers/${id}/replace`, { reason: text.trim() }); toast.success(t("common.saved")); setM(null); onDone(); }
    catch (e) {
      const n = e instanceof ApiError && e.code === "INVALID_TRANSITION" ? Number((e.details as { resolvedStops?: unknown }).resolvedStops) : NaN;
      const msg = Number.isFinite(n) && n > 0 ? t("shipadm.replace_blocked", { n }) : errText(e, t);
      setRepErr(msg); toast.error(msg);
    } finally { setBusy(null); }
  };
  const cancel = <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>;
  return (
    <>
      <div className="flex flex-wrap gap-2">{btns}</div>
      <Modal busy={a.is("m")} open={m === "noshow"} onClose={close} title={t("adm.mark_no_show")} footer={<>{cancel}<Button variant="danger" loading={a.is("m")} disabled={!textOk} onClick={() => go("m", `/offers/${id}/attendance`, { present: false, reason: text.trim() })}>{t("common.confirm")}</Button></>}>
        <Notice tone="info">{t("req.noshow_note")}</Notice><Textarea label={t("req.reason")} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      <Modal busy={a.is("m")} open={m === "loading"} onClose={close} title={t("adm.record_loading")} footer={<>{cancel}<Button loading={a.is("m")} disabled={!unitsOk} onClick={() => go("m", `/offers/${id}/loading`, { units: Number(units) })}>{t("common.confirm")}</Button></>}>
        <Input label={t("req.loading_hint")} type="number" min={0} step={1} value={units} onChange={(e) => setUnits(e.target.value)} />
      </Modal>
      <Modal busy={(busy === "rp")} open={m === "replace"} onClose={close} title={t("office.replace")} footer={<>{cancel}<Button variant="danger" loading={busy === "rp"} disabled={!textOk} onClick={replace}>{t("common.confirm")}</Button></>}>
        {repErr && <Notice tone="danger">{repErr}</Notice>}
        {st === "attendance_confirmed" && offer.routeApprovedAt && <Notice tone="info">{t("shipadm.replace_hint_started")}</Notice>}
        <Textarea label={t("req.reason")} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      <Modal busy={a.is("m")} open={m === "end_route"} onClose={close} title={t("shipadm.end_route_title")} footer={<>{cancel}<Button variant="danger" loading={a.is("m")} disabled={!textOk} onClick={() => a.run("m", () => post(`/offers/${id}/end-route`, { reason: text.trim(), ...(note.trim() ? { note: note.trim() } : {}) }), { success: "shipadm.route_ended", onDone: () => { setM(null); onDone(); } })}>{t("shipadm.end_route")}</Button></>}>
        <Notice tone="warn" title={t("shipadm.end_route_consequences")}>
          <ul className="list-disc space-y-1 ps-5"><li>{t("shipadm.end_route_c1")}</li><li>{t("shipadm.end_route_c2")}</li><li>{t("shipadm.end_route_c3")}</li></ul>
        </Notice>
        <Input label={t("req.reason")} required maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        <Textarea label={t("shipadm.note_optional")} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}
