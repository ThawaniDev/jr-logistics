import { afterEach, describe, expect, it, vi } from "vitest";
import { err } from "@/lib/errors";
import { defineRoutes, dispatch } from "@/server/api/router";

/** The error envelope and what the server writes to its log for each kind of failure (no database: every route here is public). */
defineRoutes([
  { method: "GET", path: "/_t/unavailable", auth: "public", handler: async () => { throw err("DEPENDENCY_UNAVAILABLE", "Object storage is not configured"); } },
  { method: "GET", path: "/_t/forbidden", auth: "public", handler: async () => { throw err("FORBIDDEN"); } },
  { method: "GET", path: "/_t/boom", auth: "public", handler: async () => { throw Object.assign(new Error('Failed query: insert into users (iban) values ($1)\nparams: SA0380000000608010167519'), { cause: { code: "XX000" } }); } },
  { method: "GET", path: "/integrations/hooks/:id/:token", auth: "public", handler: async () => { throw err("INTERNAL", "boom"); } },
]);

const get = (path: string, headers: Record<string, string> = {}) => dispatch(new Request(`http://localhost:3000/api/v1${path}`, { headers }));
const logged: string[] = [];
const spy = () => vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
afterEach(() => { vi.restoreAllMocks(); logged.length = 0; });

describe("error envelope", () => {
  it("every failure has the same shape and the correlation id is in the header and the body", async () => {
    spy();
    for (const [path, status, code] of [["/_t/unavailable", 503, "DEPENDENCY_UNAVAILABLE"], ["/_t/forbidden", 403, "FORBIDDEN"], ["/_t/boom", 500, "INTERNAL"], ["/_t/missing", 404, "NOT_FOUND"]] as const) {
      const r = await get(path);
      const j = await r.json();
      expect(r.status).toBe(status);
      expect(j.error).toMatchObject({ code, correlation_id: r.headers.get("x-correlation-id"), details: {} });
      expect(typeof j.error.message).toBe("string");
      expect(Object.keys(j)).toEqual(["error"]);
    }
  });

  it("a client-supplied correlation id is echoed only when it is short and boring", async () => {
    spy();
    expect((await get("/_t/forbidden", { "x-correlation-id": "req-123.abc_9" })).headers.get("x-correlation-id")).toBe("req-123.abc_9");
    for (const bad of ["has space", "x".repeat(65), "<script>", "a;b"]) expect((await get("/_t/forbidden", { "x-correlation-id": bad })).headers.get("x-correlation-id")).not.toBe(bad);
  });
});

describe("what the server logs", () => {
  it("a deliberate 5xx (503 dependency unavailable) is logged, a 4xx is not", async () => {
    spy();
    await get("/_t/forbidden");
    expect(logged).toEqual([]);
    const r = await get("/_t/unavailable");
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({ level: "error", correlationId: r.headers.get("x-correlation-id"), method: "GET", path: "/api/v1/_t/unavailable", message: "Object storage is not configured" });
  });

  it("an unexpected error answers a generic 500 and logs without the bound parameters or a raw stack dump", async () => {
    spy();
    const r = await get("/_t/boom");
    const body = await r.text();
    expect(body).not.toMatch(/SA0380|Failed query|params/);
    expect(logged.join("\n")).not.toMatch(/SA0380|params:/);
    const j = JSON.parse(logged[0]) as { stack: string[]; pgCode: string };
    expect(j.pgCode).toBe("XX000");
    expect(j.stack.length).toBeLessThanOrEqual(6);
  });

  it("the secret token in a warehouse-system webhook URL never reaches the log", async () => {
    spy();
    await get("/integrations/hooks/conn-1/SUPERSECRETTOKEN");
    expect(logged.join("\n")).not.toContain("SUPERSECRETTOKEN");
    expect(JSON.parse(logged[0]).path).toBe("/api/v1/integrations/hooks/conn-1/[redacted]");
  });
});

describe("unknown path and wrong method", () => {
  it("404 for an unknown path; 405 says so and lists the methods the path accepts", async () => {
    spy();
    const missing = await get("/_t/nowhere");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    const wrong = await dispatch(new Request("http://localhost:3000/api/v1/_t/forbidden", { method: "DELETE" }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    expect((await wrong.json()).error).toMatchObject({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed", correlation_id: wrong.headers.get("x-correlation-id") });
  });
});
