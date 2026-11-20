import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { requests, settlements } from "@/db/schema";
import { anyWindow, inWindow, scope, twinSelect, BILLED, NOT_DRAFT, PARCEL_OUTCOME_AT } from "@/server/analytics/conditions";
import { bucketSql, riyadhDow } from "@/server/analytics/buckets";
import { parseFilters } from "@/server/analytics/filters";
import { histogramSelect } from "@/server/analytics/stats";

const dialect = new PgDialect();
const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);
const NOW = new Date("2026-11-19T10:00:00Z");
const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";

describe("filters → SQL", () => {
  it("never puts user input in the SQL text: every value is a bound parameter", () => {
    const f = parseFilters({ city: "riyadh,jeddah", service: "delivery_driver", company: ID, status: "completed" }, NOW);
    const q = render(scope(f, "requests"));
    expect(q.sql).toContain('"requests"."service" in ($1)');
    expect(q.sql).toContain('"requests"."delivery_city" in ($2, $3)');
    expect(q.sql).toContain('"requests"."business_id" in ($5)');
    expect(q.params).toEqual(["delivery_driver", "jeddah", "riyadh", "completed", ID]);
    expect(q.sql).not.toMatch(/riyadh|jeddah|completed/);
  });
  it("is `true` without filters, so it can always follow a where", () => {
    expect(render(scope(parseFilters({}, NOW), "shipments")).sql).toBe("true");
  });
  it("driver and office filters use the right column of each fact table", () => {
    const f = parseFilters({ driver: ID, office: ID }, NOW);
    expect(render(scope(f, "requests")).sql).toContain("exists (select 1 from offers where offers.request_id = requests.id");
    expect(render(scope(f, "offers")).sql).toContain('"offers"."driver_id" in ($1)');
    expect(render(scope(f, "offers")).sql).toContain('"offers"."office_id" in ($2)');
    expect(render(scope(f, "settlements")).sql).toContain('"settlements"."driver_id" in ($1)');
    expect(render(scope(f, "shipments")).sql).toContain('"shipments"."offer_id" in (select id from offers where driver_id in ($1))');
    expect(render(scope(f, "tickets")).sql).toContain('"tickets"."opened_by" in ($1)');
  });
  it("tickets match the company that opened them or whose request they concern", () => {
    const q = render(scope(parseFilters({ company: ID }, NOW), "tickets"));
    expect(q.sql).toContain('"tickets"."opened_by" in ($1) or "requests"."business_id" in ($2)');
  });
});

describe("windows", () => {
  it("compares against exact UTC instants, half open", () => {
    const f = parseFilters({ from: "2026-11-19", to: "2026-11-19", compare: "none" }, NOW);
    const q = render(inWindow(requests.createdAt, f.cur));
    expect(q.sql).toBe('("requests"."created_at" >= $1::timestamptz and "requests"."created_at" < $2::timestamptz)');
    expect(q.params).toEqual(["2026-11-18T21:00:00.000Z", "2026-11-19T21:00:00.000Z"]);
  });
  it("anyWindow ORs the current and the comparison window over every column", () => {
    const f = parseFilters({ from: "2026-11-19", to: "2026-11-19" }, NOW);
    expect(render(anyWindow(f, requests.createdAt, requests.completedAt)).sql.match(/ or /g)).toHaveLength(3);
    expect(render(anyWindow(parseFilters({ compare: "none" }, NOW), "x.at")).sql.match(/ or /g)).toBeNull();
  });
  it("twinSelect yields _c and _p columns only when there is a comparison", () => {
    const m = { n: (w: (c: string) => ReturnType<typeof sql>) => sql`count(*) filter (where ${w("created_at")})::int` };
    expect(render(twinSelect(parseFilters({}, NOW), m)).sql).toMatch(/as n_c, .* as n_p$/);
    expect(render(twinSelect(parseFilters({ compare: "none" }, NOW), m)).sql).toMatch(/as n_c$/);
    // Postgres lower-cases unquoted aliases, so camelCase metric names would silently read as "no data"
    expect(() => twinSelect(parseFilters({}, NOW), { onTime: m.n })).toThrow(/snake_case/);
  });
});

describe("bucketing in Riyadh time", () => {
  it("converts to Asia/Riyadh before truncating and shifts weeks to start on Sunday", () => {
    for (const b of ["hour", "day", "week", "month"] as const) expect(render(bucketSql(requests.createdAt, b)).sql).toContain("at time zone 'Asia/Riyadh'");
    expect(render(bucketSql(requests.createdAt, "week")).sql).toContain("date_trunc('week', (\"requests\".\"created_at\" at time zone 'Asia/Riyadh') + interval '1 day') - interval '1 day'");
    expect(render(bucketSql(requests.createdAt, "hour")).sql).toContain("'YYYY-MM-DD\"T\"HH24'");
    expect(render(riyadhDow(requests.createdAt)).sql).toContain("extract(dow from");
  });
});

describe("shared fragments", () => {
  it("count a parcel once, at the moment it was resolved", () => {
    expect(render(PARCEL_OUTCOME_AT).sql).toContain("when shipments.status = 'delivered' then shipments.delivered_at");
    expect(render(PARCEL_OUTCOME_AT).sql).toContain("coalesce(shipments.failed_at, shipments.returned_at, shipments.updated_at)");
  });
  it("drafts and rejected settlements never count", () => {
    expect(render(NOT_DRAFT).sql).toBe("requests.status <> 'draft'");
    expect(render(BILLED).sql).toBe("settlements.status <> 'rejected'");
    void settlements;
  });
  it("histogramSelect has one open-ended count per bucket", () => {
    const q = render(histogramSelect(sql`x.secs`, [10, 20], "h", sql`true`));
    expect(q.sql.match(/ as h\d/g)).toEqual([" as h0", " as h1", " as h2"]);
    expect(q.params).toEqual([10, 10, 20, 20]);
  });
});
