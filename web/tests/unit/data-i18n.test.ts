import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { ACTIVITY_KINDS, RELEVANT_GROUPS, SOURCE_GROUPS } from "@/server/activity-core";
import { KNOWN_AUDIT_ACTIONS } from "@/server/activity-sources";
import { SHIPMENT_EVENT_TYPES } from "@/server/shipment-events";
import { ALL_SOURCES } from "@/server/activity";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const hasAll = (keys: string[]) => keys.filter((k) => !(k in en) || !(k in ar) || !(k in ur));

describe("activity i18n (dtk.*)", () => {
  it("every kind, source group, link type, parcel step and audit action has a title in en + ar + ur", () => {
    const need = [
      ...ACTIVITY_KINDS.map((k) => `dtk.kind_${k}`), ...SOURCE_GROUPS.map((g) => `dtk.group_${g}`),
      ...["request", "offer", "shipment", "user", "ticket", "complaint", "settlement", "withdrawal", "company", "driver", "office", "staff"].map((r) => `dtk.ref_${r}`),
      ...SHIPMENT_EVENT_TYPES.map((t) => `dtk.p_${t}`), ...KNOWN_AUDIT_ACTIONS.map((a) => `dtk.act.${a}`),
      "dtk.audit_action", "dtk.unknown_event", "dtk.chat_message", "dtk.invoice_created", "dtk.cod_remitted", "dtk.note_added",
    ];
    expect(hasAll(need)).toEqual([]);
  });
  it("every title the sources can produce is translated", () => {
    const fixed = [
      ...["created", "approved", "paid"].map((s) => `dtk.settlement_${s}`), ...["requested", "approved", "paid", "rejected"].map((s) => `dtk.withdrawal_${s}`),
      ...["opened", "first_response", "resolved"].map((s) => `dtk.ticket_${s}`), "dtk.ticket_reply", "dtk.ticket_internal_note", "dtk.ticket_attachment",
      ...["filed", "first_response", "resolved", "note", "status", "assign"].map((s) => `dtk.complaint_${s}`),
      "dtk.rating", "dtk.rating_c", "dtk.rating_received", "dtk.rating_received_c", ...["submitted", "approved", "rejected", "info_requested", "under_review"].map((s) => `dtk.document_${s}`),
      "dtk.login_ok", "dtk.login_failed", "dtk.session_revoked", "dtk.availability_available", "dtk.availability_unavailable", "dtk.message_sent", "dtk.message_failed", "dtk.partner_event",
      ...["queued", "delivered", "retry_wait", "dead_letter"].map((s) => `dtk.webhook_${s}`), ...["defer", "fail", "signature"].map((k) => `dtk.media_${k}`),
    ];
    expect(hasAll(fixed)).toEqual([]);
    // and every literal title key written in the source files is in the list above, so a new title cannot ship untranslated
    const src = ["activity-sources.ts", "activity-sources-b.ts"].map((f) => readFileSync(join("src/server", f), "utf8")).join("\n");
    const literal = [...src.matchAll(/"(dtk\.[a-z_]+)"/g)].map((m) => m[1]);
    expect(hasAll(literal)).toEqual([]);
  });
  it("words used inside titles ({method}, {source}, {channel}, {reason} …) are translated", () => {
    const words = [
      ...["otp", "password", "api_key", "session"].map((m) => `dtk.method_${m}`), ...["driver", "system", "admin"].map((m) => `dtk.src_${m}`), ...["sms", "push", "webhook", "email", "inapp"].map((m) => `dtk.channel_${m}`),
      ...["in", "out", "lookup", "test"].map((m) => `dtk.dir_${m}`), ...["otp", "recipient_code", "recipient_track", "driver_alert", "office_alert"].map((m) => `dtk.msg_${m}`),
      ...["invalid_code", "bad_password", "unknown_user", "locked", "rate_limited", "suspended", "wrong_portal", "mfa_failed", "invalid_credentials"].map((m) => `dtk.fail_${m}`),
      ...["logout", "password_changed", "suspended", "permissions_changed", "password_reset", "revoked"].map((m) => `dtk.revoke_${m}`),
      ...["manual", "cancel_strikes", "not_handed_over", "not_scanned", "driver_cancelled"].map((m) => `dtk.reason_${m}`),
    ];
    expect(hasAll(words)).toEqual([]);
  });
  it("the sources cover every relevant group of every entity, and every source group exists", () => {
    for (const [entity, groups] of Object.entries(RELEVANT_GROUPS)) for (const g of groups) expect(ALL_SOURCES.some((s) => s.group === g && s.build[entity as keyof typeof s.build]), `${entity}/${g}`).toBe(true);
    for (const s of ALL_SOURCES) { expect(SOURCE_GROUPS).toContain(s.group); expect(ACTIVITY_KINDS).toContain(s.kind); }
  });
  it("every dtk key used literally in components exists and Arabic / Urdu are real translations", () => {
    const used = new Set<string>();
    // namespaces such as "dtk.fail_" (completed at runtime) end in "_" and are covered by the words test above
    for (const f of walk("src/components")) { const s = readFileSync(f, "utf8"); for (const m of s.matchAll(/"(dtk\.[a-z_.]*[a-z])"/g)) used.add(m[1]); }
    expect(hasAll([...used])).toEqual([]);
    const own = Object.keys(en).filter((k) => k.startsWith("dtk."));
    expect(own.length).toBeGreaterThan(200);
    for (const k of own) { expect(ar[k], k).not.toBe(en[k]); expect(ur[k], k).not.toBe(en[k]); expect(/[؀-ۿ]/.test(ar[k]), `ar ${k}`).toBe(true); expect(/[؀-ۿ]/.test(ur[k]), `ur ${k}`).toBe(true); }
  });
});
