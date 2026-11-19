import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sigV4, S3Storage } from "@/server/storage-s3";

const AK = "AKIAIOSFODNN7EXAMPLE", SK = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("AWS Signature V4 (published AWS test vectors)", () => {
  it("GET Object with a Range header", () => {
    const r = sigV4({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), region: "us-east-1", accessKeyId: AK, secretAccessKey: SK, amzDate: "20130524T000000Z", payloadHash: EMPTY,
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" } });
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });
  it("PUT Object with a body, a special character in the key and a custom header", () => {
    const hash = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
    const r = sigV4({ method: "PUT", url: new URL("https://examplebucket.s3.amazonaws.com/test%24file.text"), region: "us-east-1", accessKeyId: AK, secretAccessKey: SK, amzDate: "20130524T000000Z", payloadHash: hash,
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", host: "examplebucket.s3.amazonaws.com", "x-amz-content-sha256": hash, "x-amz-date": "20130524T000000Z", "x-amz-storage-class": "REDUCED_REDUNDANCY" } });
    expect(r.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });
});

describe("S3Storage against an S3-compatible endpoint", () => {
  const server = () => new Promise<{ url: string; store: Map<string, Buffer>; auth: string[]; close: () => void }>((resolve) => {
    const store = new Map<string, Buffer>(), auth: string[] = [];
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        auth.push(String(req.headers.authorization));
        const k = req.url!;
        if (req.method === "PUT") { store.set(k, Buffer.concat(chunks)); res.writeHead(200); res.end(); }
        else if (req.method === "GET") { const v = store.get(k); res.writeHead(v ? 200 : 404); res.end(v ?? ""); }
        else if (req.method === "DELETE") { store.delete(k); res.writeHead(204); res.end(); }
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, store, auth, close: () => srv.close() }));
  });

  it("puts, gets and removes objects with signed requests; missing objects are NOT_FOUND", async () => {
    const s = await server();
    const st = new S3Storage({ bucket: "jr-docs", region: "auto", accessKeyId: AK, secretAccessKey: SK, endpoint: s.url, sse: "AES256" });
    const key = "driver/abc-123/Zk9x_token";
    await st.put(key, Buffer.from("%PDF-1.4 secret"));
    expect(s.store.get(`/jr-docs/${key}`)?.toString()).toBe("%PDF-1.4 secret");
    expect((await st.get(key)).toString()).toBe("%PDF-1.4 secret");
    expect(s.auth.every((a) => /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/.test(a))).toBe(true);
    await st.remove(key);
    await expect(st.get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(st.put("../escape", Buffer.from("x"))).rejects.toMatchObject({ code: "VALIDATION" });
    s.close();
  });

  it("surfaces provider failures clearly and refuses incomplete configuration", async () => {
    const down = new S3Storage({ bucket: "b", region: "auto", accessKeyId: AK, secretAccessKey: SK, endpoint: "http://x.test", fetcher: (async () => new Response("", { status: 503 })) as typeof fetch });
    await expect(down.put("a/b", Buffer.from("x"))).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    expect(() => S3Storage.fromEnv({ S3_BUCKET: "b" } as never)).toThrowError(/S3_ACCESS_KEY_ID|S3_SECRET/);
  });
});
