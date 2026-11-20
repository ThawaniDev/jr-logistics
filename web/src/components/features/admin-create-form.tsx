"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { CheckCircle2, Plus, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ConfirmModal, fullErr } from "./admin-common";
import { useDuplicateCheck } from "./admin-create-fields";
import { AccessSection, DetailsSection, HolderSection, PlaceSection, type Ctx } from "./admin-create-sections";
import { Summary } from "./admin-create-summary";
import { CreatedScreen, CredentialsSection } from "./admin-create-credentials";
import { LIST_HREF, apiFieldErrors, buildCreatePayload, buildPatch, changedKeys, emptyForm, entityHref, phoneOf, softWarnings, validateForm, type FieldKey, type FormState, type Kind } from "./admin-create-lib";

export interface EditMeta { id: string; maskedPhone: string | null; sensitiveAllowed: boolean; officeName: string | null }
const REFRESH = /^\/admin\/(companies|offices|drivers|users|accounts|verification)/;
const smsKey: Record<string, string> = { sent: "acr.sms_sent", demo: "acr.sms_demo", unavailable: "acr.sms_unavailable", failed: "acr.sms_failed" };

/**
 * The create / edit form of a company, courier office or driver (decision G1). One component for both modes: create shows the verification and
 * sign-in options and "what will happen"; edit is prefilled, sends only what changed (`PATCH /admin/accounts/:id`) and lists the changes before saving.
 */
export function AccountForm({ kind, mode, initial, edit }: { kind: Kind; mode: "create" | "edit"; initial?: FormState; edit?: EditMeta }) {
  const { t, locale } = useI18n(); const me = useUser(); const router = useRouter(); const { mutate } = useSWRConfig();
  const [base] = useState<FormState>(() => initial ?? emptyForm(kind, "ar")); // the values the form started from (an edit diffs against them)
  const [f, setF] = useState<FormState>(base);
  const [submitted, setSubmitted] = useState(false); const [touched, setTouched] = useState<Set<string>>(new Set()); const [srv, setSrv] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState<null | "save" | "another">(null); const [leave, setLeave] = useState(false); const [done, setDone] = useState<null | { id: string; name: string; sms: string; username: string; password: string; generated: boolean }>(null);
  const top = useRef<HTMLDivElement>(null);
  const cat = useApi<{ cities: Array<Record<string, string>>; services: Array<{ key: string; driverless: boolean }>; vehicleTypes: string[] }>("/catalog");
  const canOffices = mode === "create" && kind === "driver" && hasPerm(me, "offices.manage");
  const offices = useApi<{ items: Array<{ id: string; name: string; city: string | null }> }>(canOffices ? "/admin/accounts/office-options" : null);
  // an edit does not ask whether its own, unchanged number or email is free
  const unchanged = (a: string, b: string) => mode === "edit" && a.trim().toLowerCase() === b.trim().toLowerCase();
  const dup = useDuplicateCheck(mode === "edit" && phoneOf(f.phone) === phoneOf(base.phone) ? "" : f.phone, unchanged(f.email, base.email) ? "" : f.email, edit?.id);
  const canSensitive = mode === "edit" ? !!edit?.sensitiveAllowed : hasPerm(me, "drivers.sensitive");
  const can = (p: string) => hasPerm(me, p);
  const cityOpts = (cat.data?.cities ?? []).map((c) => ({ value: c.key, label: c[locale] ?? c.key }));
  const cityName = (k: string) => cityOpts.find((c) => c.value === k)?.label ?? k;
  const svcOpts = (cat.data?.services ?? []).filter((s) => !s.driverless).map((s) => ({ key: s.key, label: t(`svc.${s.key}`) }));
  const rules = { cityKeys: cityOpts.map((c) => c.value), serviceKeys: svcOpts.map((s) => s.key), canSensitive, mode, maskedPhone: !!edit?.maskedPhone };
  const problems = validateForm(kind, f, rules);
  const warn = softWarnings(kind, f);
  const changed = mode === "edit" ? changedKeys(kind, base, f, { canSensitive }) : [];
  const neutral = (x: FormState) => JSON.stringify({ ...x, sendSms: false, language: "" }); // the starting values of the two options do not count as "typed something"
  const dirty = mode === "edit" ? changed.length > 0 : neutral(f) !== neutral(base);
  const show = (k: FieldKey) => submitted || touched.has(k) || ((k === "phone" || k === "email") && !!f[k].trim());
  const txt = (m: Partial<Record<FieldKey, string>>, only: (k: FieldKey) => boolean = () => true) => Object.fromEntries((Object.entries(m) as Array<[FieldKey, string]>).filter(([k]) => only(k)).map(([k, v]) => [k, t(v)])) as Partial<Record<FieldKey, string>>;
  const errs: Partial<Record<FieldKey, string>> = { ...txt(problems, show), ...srv };
  const warnTxt = txt(warn);
  const set: Ctx["set"] = (k, v) => { setF((p) => ({ ...p, [k]: v })); setSrv((p) => { if (!(k in p)) return p; const n = { ...p }; delete n[k]; return n; }); };
  const ctx: Ctx = {
    kind, mode, f, set, errs, warn: warnTxt, dup, cities: cityOpts, services: svcOpts, vehicles: cat.data?.vehicleTypes ?? [], offices: (offices.data?.items ?? []).map((o) => ({ value: o.id, label: o.city ? `${o.name} · ${cityName(o.city)}` : o.name })),
    canSensitive, canVerify: can("verification.manage"), canAffiliate: canOffices, canPin: mode === "create" || can("users.edit"), maskedPhone: edit?.maskedPhone, officeName: edit?.officeName,
  };
  const officeName = ctx.offices.find((o) => o.value === f.officeId)?.label;

  useEffect(() => { // unsaved work survives an accidental tab close only after a warning
    if (!dirty || busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty, busy]);
  const focusFirst = () => requestAnimationFrame(() => (document.querySelector('[data-testid^="acr-"][aria-invalid="true"]') as HTMLElement | null)?.focus());

  const finish = (id: string) => router.push(entityHref(kind, id, can));
  const submit = async (another: boolean) => {
    setSubmitted(true);
    const blocked = Object.keys(problems).length > 0 || dup.phone.state === "taken" || dup.email.state === "taken";
    if (blocked || (mode === "edit" && !changed.length)) { if (blocked) focusFirst(); return; }
    setBusy(another ? "another" : "save");
    try {
      if (mode === "create") {
        const r = await post("/admin/accounts", buildCreatePayload(kind, f, { canSensitive, canVerify: ctx.canVerify, canAffiliate: ctx.canAffiliate }));
        toast.success(t("acr.created", { name: r.user.name })); if (f.sendSms && smsKey[r.sms]) toast.info(t(smsKey[r.sms]));
        await mutate((k) => typeof k === "string" && REFRESH.test(k));
        // The sign-in details are shown once, on their own screen (the password is only stored as a hash). `another` decides what the form keeps for the next account.
        setDone({ id: r.user.id, name: r.user.name, sms: r.sms, username: r.credentials?.username ?? r.user.username, password: r.credentials?.generatedPassword ?? f.password, generated: !!r.credentials?.generatedPassword });
        if (another) setF({ ...emptyForm(kind, f.language), city: f.city, sendSms: f.sendSms, verifyNow: f.verifyNow, verifyReason: f.verifyReason, services: kind === "driver" ? f.services : [] });
        setSubmitted(false); setTouched(new Set()); setSrv({}); top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        const r = await patch(`/admin/accounts/${edit!.id}`, buildPatch(kind, base, f, { canSensitive }));
        toast.success(t("common.saved")); if (r.sessionsRevoked) toast.info(t("acr.sessions_ended"));
        await mutate((k) => typeof k === "string" && REFRESH.test(k) && k.includes(edit!.id));
        finish(edit!.id);
      }
    } catch (e) {
      const m = apiFieldErrors(e);
      if (e instanceof ApiError && e.code === "CONFLICT") for (const k of ["phone", "email", "username"] as const) if (m[k]) m[k] = t(k === "username" ? "ja.err_username_taken" : "acr.taken"); // the server sentence is English: say it in the user's language
      setSrv(m); toast.error(fullErr(e, t)); focusFirst();
    } finally { setBusy(null); }
  };
  const cancel = () => (dirty ? setLeave(true) : router.push(mode === "edit" ? entityHref(kind, edit!.id, can) : LIST_HREF[kind]));
  const back = mode === "edit" ? entityHref(kind, edit!.id, can) : LIST_HREF[kind];

  if (done) {
    return (
      <CreatedScreen name={done.name} openHref={entityHref(kind, done.id, can)} username={done.username} password={done.password} generated={done.generated} smsNote={f.sendSms && smsKey[done.sms] ? t(smsKey[done.sms]) : null}
        onAnother={() => { setDone(null); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="acr-name"]')?.focus()); }} />
    );
  }
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(false); }} data-testid={`acr-form-${kind}`}
      onBlurCapture={(e) => { const id = (e.target as HTMLElement).getAttribute?.("data-testid"); if (id?.startsWith("acr-")) setTouched((p) => new Set(p).add(id.slice(4))); }}>
      <div ref={top} className="scroll-mt-24" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="space-y-5">
          <HolderSection c={ctx} />{mode === "create" && <CredentialsSection c={ctx} />}<DetailsSection c={ctx} /><PlaceSection c={ctx} />
          {mode === "create" && <AccessSection c={ctx} />}
        </div>
        <aside className="space-y-5 lg:sticky lg:top-24">
          <Summary kind={kind} mode={mode} f={f} initial={base} changed={changed} officeName={officeName} canVerify={ctx.canVerify} cityName={cityName} />
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center gap-3 rounded-card border border-line bg-card/95 px-4 py-3 backdrop-blur" data-testid="acr-actions">
        <div className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
          {submitted && Object.keys(problems).length > 0 ? <span className="text-danger" data-testid="acr-problems">{t("acr.n_problems", { n: Object.keys(problems).length })}</span>
            : mode === "edit" ? (changed.length ? t("acr.changes_n", { n: changed.length }) : t("acr.changes_none")) : t("acr.required_note")}
        </div>
        <Button type="button" variant="ghost" onClick={cancel} disabled={!!busy} data-testid="acr-cancel">{t("common.cancel")}</Button>
        {mode === "edit" && <Button type="button" variant="secondary" disabled={!changed.length || !!busy} onClick={() => { setF(base); setSrv({}); setSubmitted(false); setTouched(new Set()); }} data-testid="acr-reset"><RotateCcw className="size-4 rtl:-scale-x-100" aria-hidden />{t("acr.discard")}</Button>}
        {mode === "create" && <Button type="button" variant="secondary" loading={busy === "another"} disabled={!!busy} onClick={() => void submit(true)} data-testid="acr-create-another"><Plus className="size-4" aria-hidden />{t("acr.create_another")}</Button>}
        <Button type="submit" loading={busy === "save"} disabled={!!busy || (mode === "edit" && !changed.length)} data-testid="acr-submit">
          {mode === "create" ? <CheckCircle2 className="size-4" aria-hidden /> : <Save className="size-4" aria-hidden />}{t(mode === "create" ? "acr.create" : "common.save")}
        </Button>
      </div>
      <ConfirmModal open={leave} onClose={() => setLeave(false)} title={t("acr.leave_title")} confirmLabel={t("acr.leave_confirm")} danger onConfirm={() => router.push(back)}>
        <p className="text-sm">{t("acr.leave_body")}</p>
      </ConfirmModal>
    </form>
  );
}
