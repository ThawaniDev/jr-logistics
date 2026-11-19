"use client";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { Notice, ProgressBar, errText } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { parcelPct, type Parcels } from "./office-lib";

type TFn = (k: string, v?: Record<string, string | number>) => string;

/** Server messages of the invite endpoint → localized text (falls back to the server message). */
const INVITE_MSG: Record<string, string> = {
  "This number belongs to a non-driver account": "office.inv_err_non_driver",
  "You cannot invite your own number": "office.inv_err_own",
  "Driver is already linked to another office": "office.inv_err_other_office",
  "Driver is already linked to your office": "office.inv_err_linked",
  "An invitation is already pending for this number": "office.inv_err_pending",
};

/** Explains an invite failure; CONFLICT/VALIDATION show the (localized) server message instead of a generic one. */
export function inviteErrText(e: unknown, t: TFn): string {
  if (e instanceof ApiError && (e.code === "CONFLICT" || e.code === "VALIDATION" || e.code === "VERIFICATION_REQUIRED")) {
    const key = INVITE_MSG[e.message];
    if (key) return t(key);
    if (e.code === "VERIFICATION_REQUIRED") return errText(e, t);
    return e.message;
  }
  return errText(e, t);
}

/** Explains an assign failure: NOT_ELIGIBLE with the reason codes (office reservations no longer exist). */
export function assignErrText(e: unknown, t: TFn): string {
  if (e instanceof ApiError) {
    const reasons = (e.details as { reasons?: unknown }).reasons;
    if (e.code === "NOT_ELIGIBLE" && Array.isArray(reasons) && reasons.length) {
      return t("office.err_not_eligible", { reasons: reasons.map((r) => reasonLabel(String(r), t)).join(", ") });
    }
    if (e.code === "NOT_ELIGIBLE") return e.message;
  }
  return errText(e, t);
}

export function reasonLabel(code: string, t: TFn): string {
  const s = t(`reason.${code}`);
  return s.startsWith("reason.") ? code : s;
}

export interface ParcelProgress { total: number | null; delivered: number; failed: number; remaining: number | null; lastAt: string | null; failures: Array<{ code: string; reason: string | null; at: string }> }

/**
 * Parcel progress of one driver's route, derived from the job timeline the office is already allowed to read (`GET /offers/:id/timeline`).
 * Until the server exposes per-job parcel counts to offices this is the only source: total = stops of the approved route,
 * delivered / failed = distinct parcel codes by their latest outcome event.
 */
export function parcelProgress(events: Array<{ type: string; createdAt: string; payload?: { code?: string; stops?: number; reason?: string } | null }>): ParcelProgress {
  const outcome = new Map<string, { type: "delivered" | "failed"; reason: string | null; at: string }>();
  let total: number | null = null; let lastAt: string | null = null;
  for (const e of events) {
    lastAt = e.createdAt;
    if (e.type === "route_approved" && typeof e.payload?.stops === "number") total = e.payload.stops;
    if ((e.type === "shipment_delivered" || e.type === "shipment_failed") && e.payload?.code) outcome.set(e.payload.code, { type: e.type === "shipment_delivered" ? "delivered" : "failed", reason: e.payload.reason ?? null, at: e.createdAt });
  }
  const all = [...outcome.entries()];
  const delivered = all.filter(([, o]) => o.type === "delivered").length;
  const failures = all.filter(([, o]) => o.type === "failed").map(([code, o]) => ({ code, reason: o.reason, at: o.at }));
  return { total, delivered, failed: failures.length, remaining: total == null ? null : Math.max(0, total - delivered - failures.length), lastAt, failures };
}

/** Parcel progress of one job as a thin bar plus "3 of 5 delivered"; a count-based job (no parcel rows) shows a dash. */
export function ParcelBar({ parcels }: { parcels: Parcels | null | undefined }) {
  const { t, locale } = useI18n();
  const pct = parcelPct(parcels);
  if (!parcels || pct === null) return <span className="text-muted">—</span>;
  return (
    <div className="w-36 max-w-full space-y-1">
      <ProgressBar value={pct} label={t("a11y.progress")} tone={parcels.failed > 0 ? "gold" : "accent"} />
      <p className="text-xs text-muted"><span className="ltr-num tabular-nums">{t("rdo.parcels_of", { done: fmtNum(parcels.delivered, locale), total: fmtNum(parcels.total, locale) })}</span>{parcels.failed > 0 && <span className="ms-1.5 font-medium text-danger">· {t("dstop.prog_failed", { n: fmtNum(parcels.failed, locale) })}</span>}{parcels.returned > 0 && <span className="ms-1.5 text-muted">· {t("rdo.parcels_returned", { n: fmtNum(parcels.returned, locale) })}</span>}</p>
    </div>
  );
}

/** Why the office cannot work yet and where to fix it (documents or agreement). Shown on the dashboard and the opportunities page. */
export function NotReadyNotice({ verification }: { verification: string }) {
  const { t } = useI18n();
  const unverified = verification !== "verified";
  return (
    <Notice tone="warn" title={t("office.not_ready")}>
      {unverified ? t("office.need_verification") : t("office.need_agreement")}{" "}
      <Link href={unverified ? "/office/documents" : "/office/agreement"} className="inline-flex min-h-11 items-center font-semibold text-cyan underline">{t("office.fix_now")}</Link>
    </Notice>
  );
}

/** A small bordered link that looks like a secondary button (row actions that navigate). */
export const linkBtn = "inline-flex h-8 items-center rounded-xl border border-line px-3 text-xs font-medium transition hover:border-accent/60 hover:bg-card pointer-coarse:h-10";
