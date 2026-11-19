import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import dns from "node:dns/promises";
import type { AddressInfo } from "node:net";
import { pinnedFetch, isPrivateIp, resolveWebhookTarget } from "@/server/integrations";

afterEach(() => { vi.restoreAllMocks(); });
const listen = () => new Promise<{ port: number; seen: Array<{ host?: string; body: string }>; close: () => void }>((resolve) => {
  const seen: Array<{ host?: string; body: string }> = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { seen.push({ host: req.headers.host, body: b }); res.writeHead(202); res.end("ok"); }); });
  srv.listen(0, "127.0.0.1", () => resolve({ port: (srv.address() as AddressInfo).port, seen, close: () => srv.close() }));
});

describe("webhook SSRF defence", () => {
  it("classifies private, loopback, link-local, mapped-IPv4 and reserved ranges", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("DNS rebinding: connects to the address that was validated, never re-resolves the name", async () => {
    const srv = await listen();
    // first answer = the (validated) good address; any second lookup would return the attacker's internal target
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never).mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    const res = await pinnedFetch(`http://rebind.example.test:${srv.port}/hook`, { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });
    expect(res.status).toBe(202);
    expect(srv.seen).toEqual([{ host: `rebind.example.test:${srv.port}`, body: '{"a":1}' }]); // SNI/Host untouched, bytes delivered
    expect(lookup).toHaveBeenCalledTimes(1);
    srv.close();
  });

  it("production refuses names that resolve to private space, and never follows redirects", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try { await expect(resolveWebhookTarget("https://metadata.example.test/x")).rejects.toMatchObject({ code: "VALIDATION" }); }
    finally { (process.env as Record<string, string>).NODE_ENV = prev!; }
    const redirector = http.createServer((_q, r) => { r.writeHead(302, { location: "http://169.254.169.254/latest" }); r.end(); });
    await new Promise<void>((ok) => redirector.listen(0, "127.0.0.1", () => ok()));
    const port = (redirector.address() as AddressInfo).port;
    const res = await pinnedFetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" });
    expect(res.status).toBe(302); // returned as-is → treated as a failed delivery, never followed
    redirector.close();
  });
});
