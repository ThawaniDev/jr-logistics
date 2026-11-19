import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { describeError } from "@/lib/log";
import { trackingUrl } from "@/server/shipments";
import { notifHref } from "@/lib/notif-link";
import { likeEscape } from "@/lib/sql";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("every user-facing error and notification has copy in all three languages", () => {
  it("each ErrorCode has an err.* message in en / ar / ur", () => {
    const codes = [...readFileSync("src/lib/errors.ts", "utf8").matchAll(/\b([A-Z][A-Z_]+): \d{3}\b/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(25);
    const missing = codes.flatMap((c) => (["en", "ar", "ur"] as const).filter((l) => !({ en, ar, ur }[l] as Record<string, string>)[`err.${c}`]).map((l) => `${l}:err.${c}`));
    expect(missing).toEqual([]);
  });
  it("each notification type raised by the server has a notif.* message in all languages", () => {
    const types = new Set<string>();
    for (const f of walk("src/server")) for (const m of readFileSync(f, "utf8").matchAll(/notify(?:Many|Ops)?\(\s*(?:[^,"]+,\s*)?"([a-z_]+)"(?:,|\))/g)) types.add(m[1]);
    const missing = [...types].flatMap((t) => (["en", "ar", "ur"] as const).filter((l) => !({ en, ar, ur }[l] as Record<string, string>)[`notif.${t}`]).map((l) => `${l}:notif.${t}`));
    expect(missing.filter((m) => !/notif\.(document_|verification_)/.test(m))).toEqual([]);
  });
});

describe("pure helpers added by the audit", () => {
  it("error descriptions drop bound parameters and secrets and cap the message", () => {
    const e = Object.assign(new Error('Failed query: insert into users ...\nparams: +966555,SA0380000000608010167519,$2a$10$hash'), { cause: { code: "23505", constraint: "users_phone_unique" } });
    const d = describeError(e);
    expect(JSON.stringify(d)).not.toMatch(/SA0380|\$2a\$|966555/);
    expect(d.pgCode).toBe("23505");
    expect(describeError(new Error("login failed password=hunter2 token: abc")).message).not.toMatch(/hunter2|abc/);
    expect(describeError(new Error("x".repeat(5000))).message.length).toBeLessThanOrEqual(300);
  });
  it("LIKE wildcards in user text are matched literally", () => { expect(likeEscape("100%_a\\b")).toBe("100\\%\\_a\\\\b"); });
  it("the recipient's tracking link carries only the last four digits of their phone", () => {
    const u = trackingUrl("JR-000001-002", "+966555123456");
    expect(u).toMatch(/\/track\/JR-000001-002\?p=3456$/);
    expect(u).not.toContain("555123");
    expect(trackingUrl("JR-000001-002")).not.toContain("?p=");
  });
  it("business parcel notifications open the request; connection problems open Integrations", () => {
    expect(notifHref("business", "shipment_failed", { requestId: "r1" })).toBe("/business/requests/r1");
    expect(notifHref("business", "route_ended_early", { requestId: "r1" })).toBe("/business/requests/r1");
    expect(notifHref("business", "shipment_failed", {})).toBe("/business/requests");
    expect(notifHref("business", "partner_cancel_conflict", { requestId: "r1" })).toBe("/business/integrations");
    expect(notifHref("business", "partner_sync_failed", {})).toBe("/business/integrations");
  });
  it("staff notifications open the matching admin page", () => {
    expect(notifHref("admin", "withdrawal_hold", {})).toBe("/admin/finance/withdrawals");
    expect(notifHref("staff", "wallet_adjusted", {})).toBe("/admin/finance/ledger");
    expect(notifHref("admin", "ticket_new", { ref: "TKT-000007" })).toBe("/admin/cases?q=TKT-000007");
    expect(notifHref("staff", "complaint_filed", { ref: "CMP 1" })).toBe("/admin/complaints?q=CMP%201");
    expect(notifHref("admin", "ticket_reply_user", {})).toBe("/admin/cases");
    expect(notifHref("driver", "ticket_reply", { ref: "T1" })).toBe("/driver/support");
    expect(notifHref("driver", "withdrawal_paid", {})).toBe("/driver/wallet");
  });
});

describe("security headers", () => {
  it("every page is unframeable and nosniff; API responses get a locked-down CSP", async () => {
    const cfg = (await import("../../next.config")).default;
    const rules = await cfg.headers!();
    const all = Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((h) => [h.key, h.value]));
    expect(all["X-Frame-Options"]).toBe("DENY"); expect(all["X-Content-Type-Options"]).toBe("nosniff");
    expect(all["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/); expect(all["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(all["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    const api = Object.fromEntries(rules.find((r) => r.source === "/api/:path*")!.headers.map((h) => [h.key, h.value]));
    expect(api["Content-Security-Policy"]).toMatch(/default-src 'none'/);
  });
});
