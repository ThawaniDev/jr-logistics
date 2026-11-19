import { describe, it, expect } from "vitest";
import {
  ACTIVE_JOB, agreementSummary, attentionItems, completionPct, docAlerts, driverCounts, driverMatches, jobCounts, jobMatches, jobNeedsAttention, matchesQuery, oppCounts, oppMatches,
  openSlots, paginate, parcelPct, periodInvalid, periodQuery, periodRange, settlementCounts, toPage, waitingJobs, type OfficeAgreement, type Parcels,
} from "@/components/features/office-lib";

const P = (o: Partial<Parcels> = {}): Parcels => ({ total: 10, delivered: 0, failed: 0, returned: 0, pending: 0, loaded: 0, missing: 0, ...o });
const NOW = new Date("2026-11-19T09:00:00Z"); // 12:00 in Riyadh
const agr = (o: Partial<OfficeAgreement> & { version: number; status: string }): OfficeAgreement => ({ id: `a${o.version}`, terms: null, acceptedAt: null, expiresAt: null, effectiveAt: null, createdAt: "2026-01-01T00:00:00Z", ...o });

describe("search and paging helpers", () => {
  it("matches text case-insensitively and phones without formatting", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("bilal", "Bilal Ahmed")).toBe(true);
    expect(matchesQuery("nak", null, "Nakheel Fresh Foods")).toBe(true);
    expect(matchesQuery("0500 000 015", "+966500000015")).toBe(true); // local form with the leading zero
    expect(matchesQuery("500000015", "+966500000015")).toBe(true);
    expect(matchesQuery("66 500", "+966 500 000 015")).toBe(true);
    expect(matchesQuery("zzz", "Bilal", undefined)).toBe(false);
  });
  it("paginates and clamps the page number", () => {
    const rows = Array.from({ length: 7 }, (_, i) => i);
    expect(paginate(rows, 1, 3)).toEqual([0, 1, 2]);
    expect(paginate(rows, 3, 3)).toEqual([6]);
    expect(paginate(rows, 0, 3)).toEqual([0, 1, 2]);
    expect(toPage("4")).toBe(4); expect(toPage("0")).toBe(1); expect(toPage("x")).toBe(1); expect(toPage(null)).toBe(1); expect(toPage("2.5")).toBe(1);
  });
});

describe("jobs", () => {
  it("buckets every status exactly once into active / completed / not completed", () => {
    for (const s of ACTIVE_JOB) expect([jobMatches({ status: s, parcels: null }, "active"), jobMatches({ status: s, parcels: null }, "completed"), jobMatches({ status: s, parcels: null }, "closed")]).toEqual([true, false, false]);
    expect(jobMatches({ status: "completed", parcels: null }, "completed")).toBe(true);
    for (const s of ["cancelled", "no_show", "replaced", "expired"]) expect(jobMatches({ status: s, parcels: null }, "closed")).toBe(true);
    expect(jobMatches({ status: "cancelled", parcels: null }, "all")).toBe(true);
  });
  it("flags a disputed quantity and active routes with undelivered or missing parcels, never finished jobs", () => {
    expect(jobNeedsAttention({ status: "qty_disputed", parcels: null })).toBe(true);
    expect(jobNeedsAttention({ status: "attendance_confirmed", parcels: P({ failed: 1 }) })).toBe(true);
    expect(jobNeedsAttention({ status: "attendance_confirmed", parcels: P({ missing: 2 }) })).toBe(true);
    expect(jobNeedsAttention({ status: "attendance_confirmed", parcels: P({ delivered: 3 }) })).toBe(false);
    expect(jobNeedsAttention({ status: "completed", parcels: P({ failed: 4 }) })).toBe(false);
  });
  it("counts per filter and the completion rate", () => {
    const jobs = [{ status: "offered", parcels: null }, { status: "accepted", parcels: null }, { status: "qty_disputed", parcels: null }, { status: "completed", parcels: null }, { status: "completed", parcels: null }, { status: "no_show", parcels: null }];
    expect(jobCounts(jobs)).toEqual({ active: 3, attention: 1, completed: 2, closed: 1, all: 6 });
    expect(waitingJobs(jobs)).toBe(1);
    expect(completionPct(2, 1)).toBe(67); expect(completionPct(0, 0)).toBeNull(); expect(completionPct(3, 0)).toBe(100);
  });
  it("parcel progress counts every parcel with a final outcome", () => {
    expect(parcelPct(null)).toBeNull(); expect(parcelPct(P({ total: 0 }))).toBeNull();
    expect(parcelPct(P({ delivered: 3, failed: 1, returned: 1 }))).toBe(50);
    expect(parcelPct(P({ total: 25, delivered: 3, returned: 22 }))).toBe(100);
    expect(parcelPct(P({ delivered: 99 }))).toBe(100);
  });
});

describe("drivers", () => {
  const d = (verificationStatus: string, availability: string, onJob: boolean) => ({ verificationStatus, availability, onJob });
  it("classifies available / on a job / offline / not verified", () => {
    expect(driverMatches(d("verified", "available", false), "available")).toBe(true);
    expect(driverMatches(d("verified", "available", true), "available")).toBe(false);
    expect(driverMatches(d("verified", "available", true), "on_job")).toBe(true);
    expect(driverMatches(d("verified", "offline", false), "offline")).toBe(true);
    expect(driverMatches(d("pending", "available", false), "available")).toBe(false);
    expect(driverMatches(d("pending", "offline", false), "offline")).toBe(false);
    expect(driverMatches(d("rejected", "available", false), "unverified")).toBe(true);
    expect(driverMatches(d("verified", "available", false), "invited")).toBe(false);
    expect(driverMatches(d("pending", "offline", false), "all")).toBe(true);
  });
  it("counts each state and carries the invitation count", () => {
    const list = [d("verified", "available", false), d("verified", "available", true), d("verified", "offline", false), d("pending", "available", false)];
    expect(driverCounts(list, 3)).toEqual({ all: 4, available: 1, on_job: 1, offline: 1, unverified: 1, invited: 3 });
  });
});

describe("settlements and opportunities", () => {
  it("counts settlements per status", () => {
    expect(settlementCounts([{ status: "paid" }, { status: "paid" }, { status: "failed" }])).toEqual({ all: 3, pending_review: 0, reviewed: 0, approved: 0, paid: 2, failed: 1, rejected: 0 });
  });
  it("filters and counts opportunities", () => {
    const o = (eligible: number, preferred: boolean) => ({ eligibleDrivers: Array.from({ length: eligible }, (_, i) => ({ id: String(i), name: "d" })), preferred });
    const list = [o(2, false), o(0, true), o(1, true)];
    expect(oppCounts(list)).toEqual({ all: 3, ready: 2, none: 1, preferred: 2 });
    expect(oppMatches(list[1], "none")).toBe(true); expect(oppMatches(list[1], "ready")).toBe(false);
    expect(openSlots({ quantity: 3, slotsFilled: 1 })).toBe(2); expect(openSlots({ quantity: 1, slotsFilled: 4 })).toBe(0);
  });
});

describe("report periods (Riyadh business days)", () => {
  it("builds inclusive ranges from today's Riyadh date", () => {
    expect(periodRange("all", NOW)).toEqual({ from: "", to: "" });
    expect(periodRange("today", NOW)).toEqual({ from: "2026-11-19", to: "2026-11-19" });
    expect(periodRange("7d", NOW)).toEqual({ from: "2026-11-13", to: "2026-11-19" });
    expect(periodRange("30d", NOW)).toEqual({ from: "2026-10-21", to: "2026-11-19" });
    expect(periodRange("month", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-19" });
  });
  it("uses the Riyadh date even when UTC is still the previous day", () => {
    expect(periodRange("today", new Date("2026-11-18T22:30:00Z"))).toEqual({ from: "2026-11-19", to: "2026-11-19" }); // 01:30 in Riyadh
  });
  it("accepts custom dates only when they are real dates and flags an inverted range", () => {
    expect(periodRange("custom", NOW, { from: "2026-11-01", to: "2026-11-05" })).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(periodRange("custom", NOW, { from: "11/01/2026", to: "2026-13-45" })).toEqual({ from: "", to: "" });
    expect(periodInvalid({ from: "2026-11-05", to: "2026-11-01" })).toBe(true);
    expect(periodInvalid({ from: "2026-11-01", to: "" })).toBe(false);
  });
  it("encodes the range as the API's from / to timestamps (start and end of the Riyadh day)", () => {
    expect(periodQuery({ from: "", to: "" })).toBe("");
    const q = new URLSearchParams(periodQuery({ from: "2026-11-01", to: "2026-11-05" }));
    expect(q.get("from")).toBe("2026-10-31T21:00:00.000Z"); expect(q.get("to")).toBe("2026-11-05T20:59:00.000Z");
  });
});

describe("agreement summary", () => {
  it("is none when nothing was sent", () => { expect(agreementSummary([], NOW).state).toBe("none"); });
  it("is active without an expiry, expiring inside 30 days, expired afterwards", () => {
    expect(agreementSummary([agr({ version: 1, status: "accepted", acceptedAt: "2026-01-02T00:00:00Z" })], NOW)).toMatchObject({ state: "active", daysLeft: null });
    expect(agreementSummary([agr({ version: 1, status: "accepted", expiresAt: "2026-12-10T09:00:00Z" })], NOW)).toMatchObject({ state: "expiring", daysLeft: 21 });
    expect(agreementSummary([agr({ version: 1, status: "accepted", expiresAt: "2027-06-01T00:00:00Z" })], NOW).state).toBe("active");
    const expired = agreementSummary([agr({ version: 1, status: "accepted", expiresAt: "2026-11-01T00:00:00Z" })], NOW);
    expect(expired).toMatchObject({ state: "expired", daysLeft: 0, active: null });
  });
  it("a newer version waiting for acceptance wins, and the accepted one stays the active terms", () => {
    const s = agreementSummary([agr({ version: 1, status: "accepted" }), agr({ version: 2, status: "pending_acceptance" })], NOW);
    expect(s.state).toBe("pending"); expect(s.pending?.version).toBe(2); expect(s.active?.version).toBe(1); expect(s.history.map((x) => x.version)).toEqual([2, 1]);
  });
  it("treats superseded-only history as none", () => { expect(agreementSummary([agr({ version: 1, status: "superseded" })], NOW).state).toBe("none"); });
});

describe("document alerts", () => {
  const doc = (type: string, status: string, expiresOn: string | null, createdAt = "2026-06-01T00:00:00Z") => ({ type, status, expiresOn, createdAt });
  it("looks at the latest upload of each type only", () => {
    const a = docAlerts([doc("cr", "approved", "2026-11-01", "2026-01-01T00:00:00Z"), doc("cr", "approved", "2027-05-01", "2026-09-01T00:00:00Z")], NOW);
    expect(a).toEqual({ expired: 0, expiring: 0, attention: 0 });
  });
  it("counts expired, expiring within 30 days and rejected / info requested", () => {
    const a = docAlerts([doc("cr", "approved", "2026-11-18"), doc("vat", "approved", "2026-12-19"), doc("lic", "approved", "2026-12-20"), doc("id", "rejected", null), doc("x", "info_requested", "2027-01-01"), doc("y", "submitted", null)], NOW);
    expect(a).toEqual({ expired: 1, expiring: 1, attention: 2 });
  });
});

describe("dashboard attention list", () => {
  const base = { readiness: { verification: "verified", agreement: "accepted", ready: true } };
  it("is empty when everything is fine", () => { expect(attentionItems({ ...base, agreement: agreementSummary([agr({ version: 1, status: "accepted" })], NOW), docs: { expired: 0, expiring: 0, attention: 0 }, drivers: [], invites: 0, opportunities: { ready: 0 }, jobs: [], failedCents: 0 })).toEqual([]); });
  it("lists problems most urgent first with a link to where they are fixed", () => {
    const items = attentionItems({
      readiness: { verification: "pending", agreement: "none", ready: false }, agreement: agreementSummary([agr({ version: 3, status: "pending_acceptance" })], NOW),
      docs: { expired: 1, expiring: 2, attention: 0 }, drivers: [{ verificationStatus: "pending" }, { verificationStatus: "verified" }], invites: 2, opportunities: { ready: 4 },
      jobs: [{ status: "qty_disputed", parcels: null }, { status: "completed", parcels: P({ failed: 2 }) }], failedCents: 500,
    });
    expect(items.map((i) => i.id)).toEqual(["verify", "docs_expired", "failed_pay", "agreement", "docs_expiring", "jobs", "drivers_unverified", "opps", "invites"]);
    expect(items.map((i) => i.tone)).toEqual(["danger", "danger", "danger", "warn", "warn", "warn", "warn", "info", "info"]);
    expect(items.find((i) => i.id === "agreement")).toMatchObject({ key: "rdo.att_agreement_pending", vars: { v: 3 }, href: "/office/agreement" });
    expect(items.find((i) => i.id === "jobs")).toMatchObject({ vars: { n: 1 }, href: "/office/jobs?status=attention" });
    expect(items.find((i) => i.id === "drivers_unverified")).toMatchObject({ vars: { n: 1 }, href: "/office/drivers?state=unverified" });
    expect(items.find((i) => i.id === "opps")).toMatchObject({ vars: { n: 4 }, href: "/office/opportunities?filter=ready" });
  });
  it("tells a verified office that the agreement has not been sent, an expired one that it lapsed", () => {
    expect(attentionItems({ ...base, agreement: agreementSummary([], NOW) }).map((i) => i.key)).toEqual(["rdo.att_agreement_none"]);
    expect(attentionItems({ ...base, agreement: agreementSummary([agr({ version: 1, status: "accepted", expiresAt: "2026-01-01T00:00:00Z" })], NOW) })[0]).toMatchObject({ key: "rdo.att_agreement_expired", tone: "danger" });
    expect(attentionItems({ readiness: { verification: "pending", agreement: "none", ready: false }, agreement: agreementSummary([], NOW) }).map((i) => i.id)).toEqual(["verify"]);
  });
});
