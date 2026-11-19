import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp — never trust what the client wrote", () => {
  it("one trusted proxy: uses the right-most entry (appended by our proxy), ignoring spoofed left entries", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), "1")).toBe("1.2.3.4");
    // an attacker rotating the first value cannot change the bucket
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }), "1")).toBe(clientIp(h({ "x-forwarded-for": "8.8.8.8, 1.2.3.4" }), "1"));
  });
  it("two trusted proxies: the second from the right", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.9" }), "2")).toBe("1.2.3.4");
  });
  it("fewer entries than trusted hops → the header did not pass through our proxies: unknown", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), "2")).toBe("unknown");
  });
  it("cloudflare mode reads CF-Connecting-IP only", () => {
    expect(clientIp(h({ "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "6.6.6.6" }), "cloudflare")).toBe("5.5.5.5");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6" }), "cloudflare")).toBe("unknown");
  });
  it("none/0 trusts no header at all; garbage values are rejected; IPv6 works", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" }), "none")).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), "0")).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }), "1")).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }), "1")).toBe("2001:db8::1");
  });
  it("no header: falls back to x-real-ip when valid, else unknown", () => {
    expect(clientIp(h({ "x-real-ip": "7.7.7.7" }), "1")).toBe("7.7.7.7");
    expect(clientIp(h({}), "1")).toBe("unknown");
  });
});
