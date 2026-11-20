import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import "@/server/analytics/explorer";
import { getDataset } from "@/server/analytics/explorer-registry";
import { availableColumns, availableFilters, countQuery, datasetAllowed, exprOf, groupQuery, LIMITS, pageQuery, parseRequest, viewerOf, whereOf } from "@/server/analytics/explorer-query";

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
const CTX = { graceMin: 30 };
const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";
const user = (role: "admin" | "staff", permissions: string[] = []) => ({ id: ID, role, permissions } as unknown as User);
const admin = user("admin");
const reporter = user("staff", ["reports.view", "reports.export", "requests.view"]);
const q = (s: string) => new URLSearchParams(s);
const parse = (u: User, ds: string, s = "") => parseRequest(u, getDataset(ds)!, q(s), CTX);
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { code?: string; details?: Record<string, unknown> }).code ?? "OTHER"; } };

describe("what a viewer can see of a dataset", () => {
  it("money columns and filters do not exist without finance.view, personal data is masked without drivers.sensitive", () => {
    const req = getDataset("requests")!;
    expect(availableColumns(req, viewerOf(reporter)).some((c) => c.key === "totalCents")).toBe(false);
    expect(availableColumns(req, viewerOf(admin)).some((c) => c.key === "totalCents")).toBe(true);
    expect(availableFilters(req, viewerOf(reporter)).some((f) => f.key === "total")).toBe(false);
    expect(availableFilters(req, viewerOf(admin)).some((f) => f.key === "total")).toBe(true);
    const staffSens = user("staff", ["reports.view", "reports.export", "drivers.sensitive"]);
    expect(viewerOf(staffSens)).toEqual({ money: false, sensitive: true });
    expect(viewerOf(reporter)).toEqual({ money: false, sensitive: false });
  });
  it("finance datasets need finance.view and system datasets audit.view", () => {
    expect(datasetAllowed(getDataset("settlements")!, reporter)).toBe(false);
    expect(datasetAllowed(getDataset("settlements")!, user("staff", ["finance.view"]))).toBe(true);
    expect(datasetAllowed(getDataset("audit")!, reporter)).toBe(false);
    expect(datasetAllowed(getDataset("audit")!, user("staff", ["audit.view"]))).toBe(true);
    expect(datasetAllowed(getDataset("requests")!, reporter)).toBe(true);
    expect(datasetAllowed(getDataset("audit")!, admin)).toBe(true);
  });
});

describe("parseRequest: only registered things can be asked for", () => {
  it("defaults: the dataset's default columns, newest first, 25 rows", async () => {
    const p = await parse(admin, "requests");
    expect(p.cols.map((c) => c.key)).toEqual(getDataset("requests")!.columns.filter((c) => c.default).map((c) => c.key));
    expect(p.sort.col.key).toBe("createdAt"); expect(p.sort.dir).toBe("desc"); expect(p.page).toBe(1); expect(p.pageSize).toBe(25); expect(p.group).toBeNull(); expect(p.aggs).toEqual([]);
  });
  it("rejects an unknown column, sort, filter, group, aggregation, format of numbers and oversize lists with a 422", async () => {
    for (const s of ["cols=nope", "cols=ref,secret", "sort=nope", "dir=sideways", "f.nope=1", "f.status=cancelled;drop", "f.status=unknown_status", "f.quantity=abc", "f.quantity=..", "f.starts=2026-13-40..2026-14-01", "f.starts=2026-02-01..2026-01-01", "f.filled=maybe", "group=nope", "group=quantity", "group=createdAt~year", "group=status~day", "agg=sum:nope", "agg=median:quantity", "agg=count:quantity", "pageSize=101", "pageSize=0", "page=0", "page=x", `q=${"x".repeat(81)}`]) {
      expect(await code(parse(admin, "requests", s)), s).toBe("VALIDATION");
    }
  });
  it("a column or filter the viewer may not have is 'unknown' to them, not 'forbidden'", async () => {
    expect(await code(parse(reporter, "requests", "cols=ref,totalCents"))).toBe("VALIDATION");
    expect(await code(parse(reporter, "requests", "sort=totalCents"))).toBe("VALIDATION");
    expect(await code(parse(reporter, "requests", "f.total=100.."))).toBe("VALIDATION");
    expect(await code(parse(reporter, "requests", "agg=sum:totalCents&group=status"))).toBe("VALIDATION");
    expect(await code(parse(admin, "requests", "cols=ref,totalCents&f.total=100..&group=status&agg=sum:totalCents"))).toBeNull();
  });
  it("masked personal data cannot be sorted, grouped, aggregated or filtered by, but is still selectable (masked)", async () => {
    expect(await code(parse(reporter, "drivers", "sort=phone"))).toBe("VALIDATION");
    expect(await code(parse(reporter, "drivers", "cols=name,phone,iban"))).toBeNull();
    const p = await parse(reporter, "drivers", "cols=name,phone");
    expect(render(exprOf(p.cols[1], p)).sql).toContain("'•••'");
    expect(render(exprOf(p.cols[0], p)).sql).not.toContain("'•••'");
    const sens = user("staff", ["reports.view", "reports.export", "drivers.sensitive"]);
    const ps = await parse(sens, "drivers", "cols=name,phone&sort=phone");
    expect(render(exprOf(ps.cols[1], ps)).sql).not.toContain("'•••'");
  });
  it("text search ignores personal-data columns without drivers.sensitive", async () => {
    const plain = render(whereOf(await parse(reporter, "drivers", "q=0501234567")));
    expect(plain.sql).not.toContain("users.phone"); expect(plain.sql).not.toContain("national_id");
    const sens = render(whereOf(await parse(user("staff", ["reports.view", "reports.export", "drivers.sensitive"]), "drivers", "q=0501234567")));
    expect(sens.sql).toContain("users.phone");
    expect(plain.params).toContain("%0501234567%");
  });
  it("percent signs and underscores in a search are literal", async () => {
    const w = render(whereOf(await parse(admin, "requests", "q=100%25_x")));
    expect(w.params).toContain("%100\\%\\_x%");
  });
});

describe("the SQL it builds", () => {
  it("binds every value: nothing the client sent is in the SQL text", async () => {
    const s = "preset=7d&city=riyadh&company=" + ID + "&q=evil'--&f.status=cancelled,completed&f.quantity=2..9&f.filled=yes&f.starts=2026-01-01..2026-01-31&sort=quantity&dir=asc&page=3&pageSize=50";
    const p = await parse(admin, "requests", s);
    const page = render(pageQuery(p, 50, 100)), count = render(countQuery(p, LIMITS.countCap));
    for (const out of [page, count]) { expect(out.sql).not.toMatch(/evil|riyadh|cancelled|2026-01/); }
    expect(page.params).toEqual(expect.arrayContaining(["riyadh", "cancelled", "completed", ID, "%evil'--%", 2, 9]));
    expect(page.sql).toMatch(/order by requests\.quantity asc nulls last, requests\.id asc limit \$\d+ offset \$\d+$/);
    expect(count.sql).toMatch(/^select count\(\*\)::int as n from \(select 1 from requests .* limit \$\d+\) c$/);
    expect(count.params.at(-1)).toBe(LIMITS.countCap + 1);
  });
  it("aliases are the columns' own whitelisted keys, with the row id and the hidden link fields", async () => {
    const p = await parse(admin, "parcels", "cols=code,status");
    const sel = render(pageQuery(p, 10, 0)).sql;
    expect(sel).toContain('shipments.id as id'); expect(sel).toContain('shipments.code as "code"'); expect(sel).toContain('requests.id as "requestId"');
  });
  it("the period applies to the dataset's time column unless 'all time' is chosen", async () => {
    const on = render(whereOf(await parse(admin, "tickets", "from=2026-11-01&to=2026-11-05")));
    expect(on.sql).toContain("tickets.created_at >=");
    expect(on.params).toEqual(expect.arrayContaining(["2026-10-31T21:00:00.000Z", "2026-11-05T21:00:00.000Z"]));
    const off = render(whereOf(await parse(admin, "tickets", "from=2026-11-01&to=2026-11-05&all=1")));
    expect(off.sql).not.toContain("tickets.created_at >=");
  });
  it("shared filters a dataset does not honour are reported, not silently dropped", async () => {
    const p = await parse(admin, "audit", "city=riyadh&company=" + ID);
    expect(p.ignored).toEqual(["city"]);
    expect(render(whereOf(p)).sql).toContain("audit_logs.actor_id in");
    expect((await parse(admin, "requests", "city=riyadh")).ignored).toEqual([]);
  });
  it("grouping: one dimension, count plus bound aggregations, date buckets in Riyadh time, capped", async () => {
    const p = await parse(admin, "settlements", "group=createdAt~month&agg=sum:customerCents,p90:marginCents,avg:finalUnits");
    const g = render(groupQuery(p));
    expect(p.aggs.map((a) => `${a.fn}:${a.col!.key}`)).toEqual(["sum:customerCents", "p90:marginCents", "avg:finalUnits"]);
    expect(g.sql).toContain("sum(settlements.customer_cents)::float8 as a0"); expect(g.sql).toContain("percentile_cont(0.9) within group (order by settlements.margin_cents)::float8 as a1"); expect(g.sql).toContain("avg(settlements.final_units)::float8 as a2");
    expect(g.sql).toContain("at time zone 'Asia/Riyadh'"); expect(g.sql).toContain("group by 1 order by n desc, g asc nulls last limit");
    expect(g.params.at(-1)).toBe(LIMITS.groups + 1);
    const byStatus = await parse(admin, "tickets", "group=status");
    expect(byStatus.group).toMatchObject({ bucket: null });
    expect((await parse(admin, "documents", "group=expiresOn~week")).group).toMatchObject({ bucket: "week" });
    expect(render(groupQuery(await parse(admin, "documents", "group=expiresOn"))).sql).toContain("::timestamp::timestamptz");
  });
  it("job start status uses the grace period of the settings", async () => {
    const p = await parse(admin, "start-sla", "cols=requestRef,startStatus&f.startStatus=late");
    const out = render(pageQuery(p, 10, 0));
    expect(out.params).toContain(30);
    expect(out.sql).toContain("make_interval(mins =>");
  });
});
