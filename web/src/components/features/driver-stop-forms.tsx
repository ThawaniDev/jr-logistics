"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, Check, Clock, HandCoins, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Field, Notice, Textarea, errText } from "@/components/ui";
import { friendlyErr, useDriverAction } from "./driver-action";
import { ApiError, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { ScanInput } from "./barcode-scanner";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { FAIL_REASONS, codDueCents, deliverBody, deliverIssues, evidenceGate, evidenceNeeds, failBlock, failNeedsNote, fitWithin, needsOtpOf, needsSignatureOf, receiptAllowed, type DeliverIssue, type PolicyInfo } from "./driver-fieldops-utils";
import { fieldCls, getPosition, mmss, useCountdown, type Stop } from "./driver-stops-shared";

/**
 * The forms of one stop — deliver, can't deliver, postpone — shared by the focused "current stop" card and the map popup so the rules live in one place.
 * Evidence photos are uploaded only when the driver submits (never orphaned), and an upload that succeeded is re-used if the action itself has to be retried.
 */

// ───────── photos ─────────
/** Phone photos are 8–12 MB; the server takes 8 MB. Downscale to ≤ 1600 px JPEG (best effort: the original is sent if anything fails). */
export async function downscaleImage(file: Blob, max = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const { width, height, scale } = fitWithin(bmp.width, bmp.height, max);
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && file.type === "image/jpeg") { bmp.close?.(); return file; }
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    c.getContext("2d")?.drawImage(bmp, 0, 0, width, height); bmp.close?.();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", quality));
    return out ?? file;
  } catch { return file; }
}
export type MediaKind = "defer" | "fail" | "signature";
/** `POST /offers/:id/stops/:sid/media` (multipart `file` + `kind`) → the evidence id the next stop action references. */
export async function uploadStopMedia(offerId: string, stopId: string, blob: Blob, kind: MediaKind): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob, kind === "signature" ? "signature.png" : `${kind}.jpg`); fd.append("kind", kind);
  const r = await post<{ id: string; kind: string }>(`/offers/${offerId}/stops/${stopId}/media`, fd);
  return r.id;
}

/** Camera / gallery picker: `<input capture>` opens the camera on phones. The input itself carries the test id (Playwright `setInputFiles`). */
export function PhotoField({ label, hint, onChange, testId, error, disabled }: { label: string; hint?: string; onChange: (b: Blob | null) => void; testId: string; error?: string; disabled?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setBusy(true);
    try { const blob = await downscaleImage(f); setUrl(URL.createObjectURL(blob)); onChange(blob); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      <input ref={input} type="file" accept="image/*" capture="environment" data-testid={testId} className="sr-only" tabIndex={-1} aria-label={label} disabled={disabled} onChange={pick} />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview; next/image cannot optimise it
        <img src={url} alt={t("dstop.photo_alt")} className="max-h-56 w-full rounded-2xl border border-line object-contain" />
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" data-testid={`${testId}-btn`} variant={url ? "secondary" : "primary"} size="lg" loading={busy} disabled={disabled} onClick={() => input.current?.click()}><Camera className="size-5" aria-hidden />{t(url ? "dstop.retake_photo" : "dstop.take_photo")}</Button>
        {url && <Button type="button" data-testid={`${testId}-remove`} variant="ghost" size="lg" className="border border-line" onClick={() => { setUrl(null); onChange(null); }}><Trash2 className="size-4" aria-hidden />{t("fod.photo_remove")}</Button>}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Evidence uploaded for the current photo; kept so a failed action can be retried without uploading the same photo again. */
function useUploadedOnce() {
  const cache = useRef<{ blob: Blob; id: string } | null>(null);
  return async (blob: Blob, up: (b: Blob) => Promise<string>) => {
    if (cache.current && cache.current.blob === blob) return cache.current.id;
    const id = await up(blob); cache.current = { blob, id }; return id;
  };
}

// ───────── arrive ─────────
export async function arriveRequest(offerId: string, stopId: string) { return post(`/offers/${offerId}/stops/${stopId}/arrive`, await getPosition()); }

// ───────── deliver ─────────
type Errs = Partial<Record<DeliverIssue, string>>;
export function DeliverForm({ stop, offerId, onAdvanced, onRefresh, embedded = false }: { stop: Stop; offerId: string; onAdvanced: (k: string) => void; onRefresh: () => void; embedded?: boolean }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const needsOtp = needsOtpOf(stop); const needsSig = needsSignatureOf(stop); const cod = codDueCents(stop); const biz = receiptAllowed(stop);
  const [mode, setMode] = useState<"code" | "receipt">("code");
  const [code, setCode] = useState(""); const [otp, setOtp] = useState(""); const [name, setName] = useState("");
  const [cashOk, setCashOk] = useState(false); const [hasSig, setHasSig] = useState(false);
  const [errs, setErrs] = useState<Errs>({});
  const [lockedErr, setLockedErr] = useState(false); const [resent, setResent] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); const [uploading, setUploading] = useState(false); const [busy, setBusy] = useState(false);
  const submitting = useRef(false); const fileRef = useRef<HTMLInputElement>(null); const otpRef = useRef<HTMLInputElement>(null); const sig = useRef<SignaturePadHandle>(null);
  const uploadOnce = useUploadedOnce();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const locked = lockedErr || stop.otpAttemptsLeft <= 0;
  const photoOk = stop.hasProof || !!preview;
  const amount = fmtMoney(cod, locale);
  const clear = (k: DeliverIssue) => setErrs((p) => ({ ...p, [k]: undefined }));

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    clear("photo"); setUploading(true);
    try {
      const blob = await downscaleImage(f); const fd = new FormData(); fd.append("file", blob, "receipt.jpg");
      await post(`/offers/${offerId}/stops/${stop.id}/proof`, fd);
      setPreview(URL.createObjectURL(blob)); onRefresh();
    } catch (er) { setErrs((p) => ({ ...p, photo: friendlyErr(er, t) })); } finally { setUploading(false); }
  }

  const issueText: Record<DeliverIssue, string> = {
    code: t("dstop.code_needed"), otp: t("dstop.otp_needed"), name: t("dstop.receiver_needed"), photo: t("dstop.photo_needed"), cash: t("fod.cod_needed"), signature: t("fod.sig_needed"),
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (submitting.current) return; // a double tap / second Enter must never send the delivery twice
    const input = { code, otp, mode, receiverName: name, hasReceiptPhoto: photoOk, cashConfirmed: cashOk, hasSignature: hasSig };
    const issues = deliverIssues(stop, input);
    if (issues.length) { setErrs(Object.fromEntries(issues.map((k) => [k, issueText[k]]))); return; }
    setErrs({}); submitting.current = true; setBusy(true);
    try {
      const loc = await getPosition();
      let signatureMediaId: string | null = null;
      if (needsSig) {
        const blob = await sig.current?.toBlob();
        if (!blob) { setErrs({ signature: issueText.signature }); return; }
        signatureMediaId = await uploadOnce(blob, (b) => uploadStopMedia(offerId, stop.id, b, "signature"));
      }
      await post(`/offers/${offerId}/stops/${stop.id}/deliver`, { ...deliverBody(stop, input, signatureMediaId), ...loc });
      onAdvanced("dstop.delivered_ok");
    } catch (er) {
      if (er instanceof ApiError && er.code === "OTP_INVALID") {
        const left = Number(er.details.attemptsLeft ?? 0);
        setErrs({ otp: t("dstop.otp_wrong", { n: left }) }); setOtp(""); if (left <= 0) setLockedErr(true); otpRef.current?.focus();
      } else if (er instanceof ApiError && er.code === "OTP_LOCKED") { setLockedErr(true); setErrs({ otp: t("dstop.otp_locked") }); setOtp(""); }
      else if (er instanceof ApiError && er.code === "OTP_REQUIRED") setErrs({ otp: errText(er, t) });
      else if (er instanceof ApiError && er.code === "CASH_MISMATCH") { const due = Number(er.details.expectedCents); setCashOk(false); setErrs({ cash: t("fod.cod_mismatch", { amount: fmtMoney(Number.isFinite(due) ? due : cod, locale) }) }); }
      else if (er instanceof ApiError && er.code === "SIGNATURE_REQUIRED") setErrs({ signature: issueText.signature });
      else if (er instanceof ApiError && er.code === "VALIDATION" && er.details.field === "code") setErrs({ code: t("dstop.code_mismatch") });
      else if (er instanceof ApiError && er.code === "VALIDATION" && er.details.field === "receiverName") setErrs({ name: t("dstop.receiver_needed") });
      else if (er instanceof ApiError && er.code === "VALIDATION" && er.details.field === "proof") setErrs({ photo: t("dstop.photo_needed") });
      else toast.error(friendlyErr(er, t)); // network failure: everything typed stays in the form
      if (er instanceof ApiError) onRefresh();
    } finally { submitting.current = false; setBusy(false); }
  }

  const resend = () => a.run("resend", () => post(`/offers/${offerId}/stops/${stop.id}/resend-code`), { success: "dstop.code_resent", onDone: () => { setResent(true); setLockedErr(false); clear("otp"); setOtp(""); onRefresh(); }, onError: onRefresh });
  const formId = `deliver-${stop.id}${embedded ? "-sheet" : ""}`;

  const body = (
    <>
      <h3 className="text-lg font-bold">{t("dstop.deliver_title")}</h3>
      <form id={formId} data-testid="deliver-form" onSubmit={submit} className="space-y-4" noValidate>
        <ScanInput label={t("dstop.parcel_code")} hint={t(needsOtp ? "dstop.parcel_code_hint" : "fod.deliver_scan_hint")} error={errs.code} required value={code} onChange={(v) => { setCode(v); clear("code"); }}
          autoFocus={!embedded} testId="deliver-code" cameraTestId="details-scan"
          onEnter={() => { if (needsOtp && mode === "code" && otp.length < 4) otpRef.current?.focus(); else void submit(); }} />

        {cod > 0 && (
          <div data-testid="cod-box" className="space-y-3 rounded-2xl border-2 border-gold bg-gold/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold"><HandCoins className="size-5" aria-hidden />{t("fod.cod_collect_title")}</p>
            <p data-testid="cod-amount" className="ltr-num text-3xl font-extrabold text-ink">{t("fod.cod_collect_amount", { amount })}</p>
            <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 p-3", errs.cash ? "border-danger" : cashOk ? "border-accent bg-accent/10" : "border-line")}>
              <input type="checkbox" data-testid="cod-collect-confirm" checked={cashOk} onChange={(e) => { setCashOk(e.target.checked); clear("cash"); }} className="size-6 shrink-0 accent-[var(--jr-accent)]" />
              <span className="text-base font-semibold">{t("fod.cod_confirm", { amount })}</span>
            </label>
            {errs.cash ? <p role="alert" data-testid="cod-error" className="text-sm text-danger">{errs.cash}</p> : <p className="text-xs text-muted">{t("fod.cod_hint")}</p>}
          </div>
        )}

        {needsOtp && biz && (
          <div role="group" aria-label={t("dstop.proof_mode")} className="grid grid-cols-2 gap-2">
            {(["code", "receipt"] as const).map((m) => (
              <button key={m} type="button" data-testid={`proof-mode-${m}`} aria-pressed={mode === m} onClick={() => setMode(m)}
                className={cn("min-h-12 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition", mode === m ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                {t(m === "code" ? "dstop.mode_code" : "dstop.mode_receipt")}
              </button>
            ))}
          </div>
        )}

        {needsOtp && mode === "code" && (
          <div className="space-y-2">
            <Field label={t("dstop.otp")} error={errs.otp} hint={t("dstop.otp_hint")} required>
              {(id, d) => (
                <input ref={otpRef} id={id} data-testid="deliver-otp" aria-describedby={d} aria-invalid={!!errs.otp} dir="ltr" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="one-time-code" autoCorrect="off" spellCheck={false}
                  value={otp} onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 4)); clear("otp"); }}
                  className={cn(fieldCls, "h-20 text-center text-4xl font-bold tracking-[0.6em] tabular-nums ltr-num")} placeholder="••••" />
              )}
            </Field>
            {locked && !stop.canResend && <Notice tone="warn">{t("dstop.no_resends")}</Notice>}
            {locked && stop.canResend && <Notice tone="warn">{t("dstop.otp_locked")}</Notice>}
            {stop.canResend && <Button type="button" variant={locked ? "primary" : "secondary"} size="lg" full loading={a.is("resend")} onClick={resend}><RotateCw className="size-4" aria-hidden />{t("dstop.resend")}</Button>}
            {resent && <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-accent"><Check className="size-4" aria-hidden />{t("dstop.resent_inline")}</p>}
          </div>
        )}
        {needsOtp && mode === "receipt" && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t("dstop.receipt_hint")}</p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" data-testid="receipt-photo" className="sr-only" tabIndex={-1} aria-hidden onChange={pick} />
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview; next/image cannot optimise it
              <img src={preview} alt={t("dstop.photo_alt")} className="max-h-64 w-full rounded-2xl border border-line object-contain" />
            )}
            {photoOk && <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-accent"><Check className="size-4" aria-hidden />{t("dstop.photo_ok")}</p>}
            <Button type="button" variant={photoOk ? "secondary" : "primary"} size="lg" full loading={uploading} onClick={() => fileRef.current?.click()}><Camera className="size-5" aria-hidden />{t(photoOk ? "dstop.retake_photo" : "dstop.take_photo")}</Button>
            {errs.photo && <p role="alert" className="text-sm text-danger">{errs.photo}</p>}
            <Field label={t("dstop.receiver_name")} error={errs.name} hint={t("dstop.receiver_hint")} required>
              {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!errs.name} value={name} maxLength={80} autoComplete="off" onChange={(e) => { setName(e.target.value); clear("name"); }} className={cn(fieldCls, "h-14 text-lg")} />}
            </Field>
          </div>
        )}

        {needsSig && (
          <div className="space-y-2" data-testid="signature-section">
            <p className="text-sm font-semibold">{t("fod.sig_title")}{" "}<span className="text-accent" aria-hidden>*</span></p>
            <p className="text-xs text-muted">{t("fod.sig_hint")}</p>
            <SignaturePad ref={sig} onChange={(ink) => { setHasSig(ink); if (ink) clear("signature"); }} />
            {errs.signature && <p role="alert" data-testid="signature-error" className="text-sm text-danger">{errs.signature}</p>}
          </div>
        )}
        <button type="submit" className="sr-only" tabIndex={-1} disabled={busy}>{t("dstop.deliver")}</button>
      </form>
      <div className={cn("sticky bottom-0 z-20 -mb-4 border-t border-line bg-bg2/95 py-3 backdrop-blur", embedded ? "-mx-5 px-5" : "-mx-4 px-4 sm:-mx-5 sm:px-5 sm:-mb-5 sm:rounded-b-card")} data-testid="stop-action-bar">
        <Button type="submit" form={formId} data-testid="deliver-submit" size="lg" full loading={busy} disabled={uploading} className="h-14 text-lg"><Check className="size-6" aria-hidden />{t("dstop.deliver")}</Button>
      </div>
    </>
  );
  return embedded ? <div className="space-y-4">{body}</div> : <Card className="space-y-4 p-4 sm:p-5">{body}</Card>;
}

// ───────── can't deliver ─────────
export function FailForm({ stop, offerId, policy, arrived, onAdvanced, onRefresh, onClose }: { stop: Stop; offerId: string; policy: PolicyInfo; arrived: boolean; onAdvanced: (k: string) => void; onRefresh: () => void; onClose: () => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  const [reason, setReason] = useState<string>(""); const [note, setNote] = useState(""); const [photo, setPhoto] = useState<Blob | null>(null);
  const [step, setStep] = useState<"pick" | "confirm">("pick"); const [serverNote, setServerNote] = useState(false);
  const uploadOnce = useUploadedOnce();
  const waiting = policy.stopWaitMin > 0 || policy.failStrict;
  const { remaining, restart } = useCountdown(arrived && waiting ? stop.waitRemainingSec : null);
  const needsNote = !!reason && failNeedsNote(reason, policy.failStrict, serverNote);
  const block = (r: string) => failBlock(r, { strict: policy.failStrict, arrived, waitMin: policy.stopWaitMin, remainingSec: remaining });
  const ready = reason !== "" && !block(reason) && (!needsNote || note.trim().length >= 3);

  const send = async () => {
    const loc = await getPosition();
    const mediaId = photo ? await uploadOnce(photo, (b) => uploadStopMedia(offerId, stop.id, b, "fail")) : undefined;
    return post(`/offers/${offerId}/stops/${stop.id}/fail`, { reason, note: note.trim() || undefined, mediaId, ...loc });
  };
  const submit = () => a.run("fail", send, {
    onDone: () => { onClose(); onAdvanced("dstop.failed_ok"); },
    onError: (e) => {
      setStep("pick");
      if (e instanceof ApiError && e.code === "WAIT_REQUIRED") restart(Number(e.details.remainingSec ?? 60));
      if (e instanceof ApiError && e.code === "VALIDATION" && e.details.field === "note") setServerNote(true);
      onRefresh();
    },
  });

  if (step === "confirm") return (
    <>
      <Notice tone="warn" title={t("dstop.fail_confirm_title")}>{t("dstop.fail_confirm_body")}</Notice>
      <p className="rounded-xl bg-bg2 p-3 text-sm"><span className="text-muted">{t("dstop.fail_pick")}</span><br /><span className="font-semibold">{t(`stopfail.${reason}`)}</span>{note.trim() && <><br /><span className="text-muted">{note.trim()}</span></>}{photo && <><br /><span className="text-xs text-accent">{t("fod.fail_photo_attached")}</span></>}</p>
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="lg" onClick={() => setStep("pick")}>{t("common.back")}</Button><Button data-testid="fail-confirm" variant="danger" size="lg" loading={a.is("fail")} onClick={submit}>{t("dstop.fail_confirm")}</Button></div>
    </>
  );
  return (
    <>
      <fieldset className="space-y-2" data-testid="fail-reasons">
        <legend className="mb-2 text-sm font-semibold">{t("dstop.fail_pick")}</legend>
        {FAIL_REASONS.map((r) => {
          const b = block(r); const off = b != null;
          const why = b === "arrival" ? t("dstop.fail_needs_arrival") : b === "wait" ? t("dstop.fail_wait", { time: mmss(remaining) }) : null;
          return (
            <label key={r} className={cn("flex min-h-14 items-start gap-3 rounded-xl border-2 p-3 transition has-[:checked]:border-accent has-[:checked]:bg-accent/10", off ? "cursor-not-allowed border-line opacity-60" : "cursor-pointer border-line hover:border-accent/60")}>
              <input type="radio" name="fail-reason" data-testid={`fail-reason-${r}`} value={r} checked={reason === r} disabled={off} onChange={() => setReason(r)} className="mt-1 size-5 shrink-0 accent-[var(--jr-accent)]" />
              <span><span className="block font-medium">{t(`stopfail.${r}`)}</span>{why && <span className="mt-0.5 flex items-center gap-1 text-xs text-gold"><Clock className="size-3.5" aria-hidden /><span className="ltr-num">{why}</span></span>}</span>
            </label>
          );
        })}
      </fieldset>
      <Textarea data-testid="fail-note" label={t(needsNote ? "dstop.fail_note_req" : "dstop.fail_note_opt")} value={note} maxLength={300} required={needsNote} onChange={(e) => setNote(e.target.value)} />
      <PhotoField testId="fail-photo" label={t("fod.fail_photo")} hint={t("fod.fail_photo_hint")} onChange={setPhoto} />
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="lg" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="fail-continue" variant="danger" size="lg" disabled={!ready} onClick={() => setStep("confirm")}>{t("dstop.fail_continue")}</Button></div>
    </>
  );
}

// ───────── postpone / reschedule ─────────
export function DeferForm({ stop, offerId, policy, onDone, onClose, onRefresh }: { stop: Stop; offerId: string; policy: PolicyInfo; onDone: () => void; onClose: () => void; onRefresh: () => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  const [note, setNote] = useState(""); const [photo, setPhoto] = useState<Blob | null>(null);
  const [asked, setAsked] = useState<{ note?: boolean; photo?: boolean } | null>(null); const [tried, setTried] = useState(false);
  const uploadOnce = useUploadedOnce();
  const needs = evidenceNeeds(policy, asked);
  const gate = evidenceGate(needs, { note, hasPhoto: !!photo });

  const send = async () => {
    const mediaId = photo ? await uploadOnce(photo, (b) => uploadStopMedia(offerId, stop.id, b, "defer")) : undefined;
    return post(`/offers/${offerId}/stops/${stop.id}/defer`, { note: note.trim() || undefined, mediaId });
  };
  const submit = () => {
    if (!gate.ok) { setTried(true); return; }
    void a.run("defer", send, {
      onDone,
      onError: (e) => {
        if (e instanceof ApiError && e.code === "EVIDENCE_REQUIRED") { setAsked({ note: e.details.note === true, photo: e.details.photo === true }); setTried(true); return; }
        onRefresh(); if (e instanceof ApiError && e.code !== "VALIDATION") onClose();
      },
    });
  };
  return (
    <>
      <p className="text-sm text-muted">{t("dstop.postpone_body")}</p>
      {(needs.note || needs.photo) && <Notice tone="info">{t("fod.defer_evidence_note")}</Notice>}
      <Textarea data-testid="defer-note" label={t(needs.note ? "fod.defer_note_req" : "fod.defer_note_opt")} hint={t("fod.defer_note_hint")} value={note} maxLength={300} required={needs.note}
        error={tried && gate.missingNote ? t("fod.evidence_note_missing") : undefined} onChange={(e) => setNote(e.target.value)} />
      <PhotoField testId="defer-photo" label={t(needs.photo ? "fod.defer_photo_req" : "fod.defer_photo_opt")} hint={t("fod.defer_photo_hint")} onChange={setPhoto} error={tried && gate.missingPhoto ? t("fod.evidence_photo_missing") : undefined} />
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="lg" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="defer-confirm" size="lg" loading={a.is("defer")} onClick={submit}>{t("dstop.postpone_confirm")}</Button></div>
    </>
  );
}
