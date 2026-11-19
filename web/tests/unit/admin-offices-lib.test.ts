import { describe, it, expect } from "vitest";
import {
  agreementView, apiFilter, daysUntil, documentRows, driverSuspension, isPast, issueKey, needsNote, needsPager, parseAgreementFilter, parseDriverLink, parseDriverState,
  parseJobScope, parseOfficeState, parseUserRole, ratingText, strikeView, verificationActions,
} from "@/components/features/admin-offices-lib";

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const day = (n: number) => new Date(NOW + n * 864e5).toISOString();

describe("URL filters fall back to a known value", () => {
  it("accepts known values and rejects everything else", () => {
    expect(parseOfficeState("review")).toBe("review");
    expect(parseOfficeState("pending")).toBe("all");
    expect(parseOfficeState(null)).toBe("all");
    expect(parseOfficeState("<script>")).toBe("all");
    expect(parseDriverState("available")).toBe("available");
    expect(parseDriverState("verified")).toBe("all");
    expect(parseJobScope("issues")).toBe("issues");
    expect(parseJobScope("")).toBe("all");
    expect(parseUserRole("office")).toBe("office");
    expect(parseUserRole("superuser")).toBe("all");
    expect(parseAgreementFilter("pending")).toBe("pending");
    expect(parseAgreementFilter("none")).toBe("none");
    expect(parseAgreementFilter("accepted")).toBe("");
    expect(parseDriverLink("direct")).toBe("direct");
    expect(parseDriverLink("both")).toBe("");
  });
  it("leaves the all filter out of the API query", () => {
    expect(apiFilter("all")).toBe("");
    expect(apiFilter("verified")).toBe("verified");
  });
});

describe("verification actions of an account", () => {
  it("offers every decision except the one that changes nothing", () => {
    expect(verificationActions("pending")).toEqual(["verify", "request_info", "reject", "suspend"]);
    expect(verificationActions("info_requested")).toEqual(["verify", "request_info", "reject", "suspend"]);
    expect(verificationActions("verified")).toEqual(["request_info", "reject", "suspend"]);
    expect(verificationActions("suspended")).toEqual(["verify", "request_info", "reject"]);
    expect(verificationActions(undefined)).toHaveLength(4);
  });
  it("asks for a note on everything but verify (the API requires it)", () => {
    expect(needsNote("verify")).toBe(false);
    for (const a of ["request_info", "reject", "suspend"] as const) expect(needsNote(a)).toBe(true);
  });
});

describe("agreement badge", () => {
  it("covers none, pending, accepted, expired and superseded", () => {
    expect(agreementView(null)).toMatchObject({ key: "none", tone: "neutral" });
    expect(agreementView(undefined)).toMatchObject({ key: "none" });
    expect(agreementView("pending_acceptance")).toMatchObject({ key: "pending", tone: "warn", label: "adm.agr_pending" });
    expect(agreementView("accepted", null, NOW)).toMatchObject({ key: "accepted", tone: "success", label: "adm.agr_accepted" });
    expect(agreementView("accepted", day(10), NOW).key).toBe("accepted");
    expect(agreementView("accepted", day(-1), NOW)).toMatchObject({ key: "expired", tone: "danger", label: "status.expired" });
    expect(agreementView("superseded")).toMatchObject({ key: "superseded", tone: "neutral" });
  });
});

describe("why an office is not ready", () => {
  it("maps every server issue to a message and has a fallback", () => {
    for (const i of ["not_verified", "suspended", "agreement_pending", "no_agreement", "agreement_expired"]) expect(issueKey(i)).toMatch(/^rdq\.issue_/);
    expect(issueKey("something_new")).toBe("rdq.issue_other");
  });
});

describe("driver suspension", () => {
  it("is timed (strikes) or the account itself", () => {
    expect(driverSuspension({ suspendedUntil: day(2), status: "active" }, NOW)).toMatchObject({ active: true, account: false });
    expect(driverSuspension({ suspendedUntil: day(2), status: "active" }, NOW).until?.toISOString()).toBe(day(2));
    expect(driverSuspension({ suspendedUntil: day(-2), status: "active" }, NOW)).toEqual({ active: false, until: null, account: false });
    expect(driverSuspension({ suspendedUntil: null, status: "suspended" }, NOW)).toEqual({ active: true, until: null, account: true });
    expect(driverSuspension({ status: "active" }, NOW).active).toBe(false);
  });
});

describe("strike standing", () => {
  const base = { policyEnabled: true, warnAt: 2, suspendAt: 4, windowDays: 7 };
  it("counts only cancellations inside the window and after the last reset", () => {
    const v = strikeView({ ...base, resetAt: day(-3), recent: [{ at: day(-1) }, { at: day(-2) }, { at: day(-5) }, { at: day(-20) }] }, NOW);
    expect(v.rows.map((r) => r.counted)).toEqual([true, true, false, false]);
    expect(v.count).toBe(2);
    expect(v.level).toBe("warn");
  });
  it("reaches the suspension level at the limit and stays ok below the warning level", () => {
    expect(strikeView({ ...base, recent: [{ at: day(-1) }, { at: day(-1) }, { at: day(-2) }, { at: day(-3) }] }, NOW).level).toBe("suspend");
    expect(strikeView({ ...base, recent: [{ at: day(-1) }] }, NOW)).toMatchObject({ count: 1, level: "ok", max: 4 });
  });
  it("never warns when the policy is switched off", () => {
    expect(strikeView({ ...base, policyEnabled: false, recent: [{ at: day(-1) }, { at: day(-1) }, { at: day(-1) }, { at: day(-1) }] }, NOW).level).toBe("ok");
  });
});

describe("document rows", () => {
  const required = [{ key: "office_cr", required: true }, { key: "office_license", required: true }, { key: "other", required: false }];
  it("keeps the newest file per type, lists missing required types and unknown extras", () => {
    const rows = documentRows([
      { type: "office_cr", createdAt: day(-5), id: "old" }, { type: "office_cr", createdAt: day(-1), id: "new" }, { type: "legacy_type", createdAt: day(-2), id: "x" },
    ], required);
    expect(rows.map((r) => [r.key, (r.doc as { id: string } | null)?.id ?? null, r.required])).toEqual([
      ["office_cr", "new", true], ["office_license", null, true], ["other", null, false], ["legacy_type", "x", false],
    ]);
  });
  it("works with no documents at all", () => {
    expect(documentRows([], required).every((r) => r.doc === null)).toBe(true);
  });
});

describe("small helpers", () => {
  it("counts whole days until a date and detects the past", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(day(10), NOW)).toBe(10);
    expect(daysUntil(day(-1), NOW)).toBe(-1);
    expect(daysUntil("2026-11-29", NOW)).toBe(9); // a date-only value starts at 00:00, half a day before NOW + 10 days
    expect(isPast(day(-1), NOW)).toBe(true);
    expect(isPast(day(1), NOW)).toBe(false);
    expect(isPast(null, NOW)).toBe(false);
  });
  it("formats a rating and decides when a pager is needed", () => {
    expect(ratingText(4.5)).toBe("★ 4.5");
    expect(ratingText(null)).toBe("—");
    expect(needsPager(25, 25)).toBe(false);
    expect(needsPager(26, 25)).toBe(true);
  });
});
