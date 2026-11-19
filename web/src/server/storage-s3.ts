import { createHash, createHmac } from "node:crypto";
import { err } from "@/lib/errors";
import type { StorageAdapter } from "./storage";

const sha256hex = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
/** RFC 3986 encoding as AWS requires (encodeURIComponent leaves ! ' ( ) * unescaped). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export interface SigInput { method: string; url: URL; headers: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; amzDate: string; service?: string }

/** AWS Signature Version 4. Returns the `Authorization` header value. `headers` must already contain host / x-amz-date / x-amz-content-sha256. */
export function sigV4(i: SigInput): { authorization: string; signature: string; signedHeaders: string } {
  const service = i.service ?? "s3";
  const date = i.amzDate.slice(0, 8);
  const names = Object.keys(i.headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...i.url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  // S3 signs the path as sent (encoded once, not double-encoded)
  const path = i.url.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/") || "/";
  const canonical = [i.method, path, query, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");
  const scope = `${date}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + i.secretAccessKey, date), i.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature, signedHeaders };
}

export interface S3Config { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string; sse?: string; fetcher?: typeof fetch }

/**
 * Durable document storage on any S3-compatible service (AWS S3, Cloudflare R2, MinIO, …).
 * Objects are private (no ACL is ever set) and the app is the only reader: staff reviews stream through an authorised API route.
 * With `endpoint` set, path-style addressing is used (`endpoint/bucket/key`); without it, AWS virtual-hosted style.
 */
export class S3Storage implements StorageAdapter {
  name = "s3";
  constructor(private c: S3Config) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): S3Storage {
    const need = (k: string) => { const v = env[k]; if (!v) throw err("DEPENDENCY_UNAVAILABLE", `Object storage is not configured (${k} is missing)`); return v; };
    return new S3Storage({ bucket: need("S3_BUCKET"), region: env.S3_REGION || "auto", accessKeyId: need("S3_ACCESS_KEY_ID"), secretAccessKey: need("S3_SECRET_ACCESS_KEY"), endpoint: env.S3_ENDPOINT || undefined, sse: env.S3_SSE || undefined });
  }

  private urlFor(key: string) {
    if (key.includes("..") || key.startsWith("/")) throw err("VALIDATION", "Invalid key");
    const k = key.split("/").map(enc).join("/");
    if (this.c.endpoint) return new URL(`${this.c.endpoint.replace(/\/$/, "")}/${this.c.bucket}/${k}`);
    return new URL(`https://${this.c.bucket}.s3.${this.c.region}.amazonaws.com/${k}`);
  }

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer): Promise<Response> {
    const url = this.urlFor(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const payloadHash = sha256hex(body ?? "");
    const headers: Record<string, string> = { host: url.host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
    if (method === "PUT" && this.c.sse) headers["x-amz-server-side-encryption"] = this.c.sse;
    const { authorization } = sigV4({ method, url, headers, payloadHash, region: this.c.region, accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey, amzDate });
    const { host: _h, ...sendHeaders } = headers; void _h; // fetch sets Host itself
    return (this.c.fetcher ?? fetch)(url, { method, headers: { ...sendHeaders, authorization }, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(20_000) });
  }

  async put(key: string, data: Buffer) {
    const r = await this.send("PUT", key, data);
    if (!r.ok) throw err("DEPENDENCY_UNAVAILABLE", `Object storage rejected the upload (HTTP ${r.status})`);
  }
  async get(key: string) {
    const r = await this.send("GET", key);
    if (r.status === 404 || r.status === 403) throw err("NOT_FOUND", "File not found");
    if (!r.ok) throw err("DEPENDENCY_UNAVAILABLE", `Object storage error (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(key: string) {
    const r = await this.send("DELETE", key);
    if (!r.ok && r.status !== 404) throw err("DEPENDENCY_UNAVAILABLE", `Object storage error (HTTP ${r.status})`);
  }
}
