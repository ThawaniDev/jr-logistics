import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { en, ar, ur } from "@/i18n/fragments/rd-detail-2";
import { RESPONSE_LABELS } from "@/server/details-people-lib";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("dv2 translations (driver and office detail views)", () => {
  it("every key has English, Arabic and Urdu text with the same placeholders, and uses the dv2. prefix", () => {
    expect(Object.keys(en).length).toBeGreaterThan(300);
    for (const [k, v] of Object.entries(en)) {
      expect(k.startsWith("dv2."), k).toBe(true); expect(v.trim(), `en ${k}`).not.toBe("");
      expect(ar[k]?.trim(), `ar ${k}`).toBeTruthy(); expect(ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(ar[k]), `ar ${k}`).toBe(placeholders(v)); expect(placeholders(ur[k]), `ur ${k}`).toBe(placeholders(v));
    }
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort()); expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
  });
  it("Arabic and Urdu are real translations, not copies of the English text", () => {
    const same = Object.keys(en).filter((k) => (ar[k] === en[k] || ur[k] === en[k]) && !/^[A-Za-z ]{1,4}$/.test(en[k]) && !/\{|API|SMS/.test(en[k]));
    expect(same).toEqual([]);
  });
  it("every dv2. key written in the source of the detail views exists (literal keys and the families built at run time)", () => {
    const files = [...walk("src/components/features").filter((f) => /\/admin-(driver|drivers|office-detail|offices)-/.test(f)), ...walk("src/server").filter((f) => f.includes("details-people")), "src/server/api/routes/admin-details-2.ts"];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](dv2\.[a-z0-9_]*[a-z0-9])["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
  });
  it("run-time families are complete", () => {
    const fam: Record<string, string[]> = {
      period_: ["30d", "90d", "12m", "all"], bucket_: ["hour", "day", "week", "month"], client_: ["web", "mobile", "api"], lang_: ["ar", "en", "ur"], source_: ["self", "admin", "import", "api", "seed"], src_: ["system", "apply", "manual", "office", "replacement"],
      risk_: ["high_no_show", "low_acceptance", "expiring_docs", "active_strikes", "cash_held_long", "never_completed"], flag_: ["high_no_show", "low_acceptance", "expiring_docs", "active_strikes", "cash_held_long", "never_completed"],
      fn_: ["offered", "accepted", "arrived", "completed"], part_: ["cancelled", "no_show", "ratings", "available", "on_job"], avail_src_: ["driver", "system", "admin"], avail_reason_: ["manual", "cancel_strikes", "suspended", "document_expired"],
      method_: ["otp", "password", "api_key", "session"], fail_: ["invalid_code", "bad_password", "unknown_user", "locked", "rate_limited", "suspended", "wrong_portal", "mfa_failed"],
      revoke_: ["logout", "password_changed", "suspended", "permissions_changed", "password_reset", "revoked"], msg_: ["otp", "recipient_code", "recipient_track"], msg_status_: ["queued", "sent", "failed", "delivered"],
      trail_: ["user_suspended", "user_active", "driver_clear_suspension", "driver_auto_suspend"], hist_: ["invite_sent", "invite_accepted", "invite_declined", "invite_cancelled", "linked", "unlinked"], hist_by_: ["office", "staff"],
      sort_: ["jobs", "parcels", "success", "on_time", "acceptance", "rating", "no_shows", "earnings", "last_active", "name"], step_: ["offered", "accepted", "arrived", "attendance", "loaded", "delivered", "completed", "cancelled", "no_show"],
    };
    for (const [p, vs] of Object.entries(fam)) for (const v of vs) expect(`dv2.${p}${v}` in en, `dv2.${p}${v}`).toBe(true);
    for (const k of RESPONSE_LABELS) expect(k in en, k).toBe(true);
  });
});
