import { describe, it, expect } from "vitest";
import { totpAt, matchTotp, base32Encode, base32Decode, sealSecret, openSecret, signMfaToken, readMfaToken, otpauthUri } from "@/server/auth/mfa";

describe("TOTP (RFC 6238)", () => {
  const rfcSecret = Buffer.from("12345678901234567890", "ascii");
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    // 8-digit vectors from the RFC appendix; 6-digit codes are their last six digits
    expect(totpAt(rfcSecret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(rfcSecret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(totpAt(rfcSecret, Math.floor(1234567890 / 30), 8)).toBe("89005924");
    expect(totpAt(rfcSecret, Math.floor(59 / 30))).toBe("287082");
  });
  it("accepts the current window and ±1 only", () => {
    const now = 1_700_000_000_000, st = Math.floor(now / 30_000);
    expect(matchTotp(rfcSecret, totpAt(rfcSecret, st), now)).toBe(st);
    expect(matchTotp(rfcSecret, totpAt(rfcSecret, st - 1), now)).toBe(st - 1);
    expect(matchTotp(rfcSecret, totpAt(rfcSecret, st + 1), now)).toBe(st + 1);
    expect(matchTotp(rfcSecret, totpAt(rfcSecret, st + 2), now)).toBeNull();
    expect(matchTotp(rfcSecret, "12345", now)).toBeNull();
    expect(matchTotp(rfcSecret, "abcdef", now)).toBeNull();
  });
  it("base32 round-trips and authenticator-style spacing/case is tolerated", () => {
    expect(base32Encode(rfcSecret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"); // the well-known RFC secret
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(rfcSecret)).toBe(true);
    expect(() => base32Decode("!!!")).toThrow();
    expect(otpauthUri("a@b.test", "ABC")).toBe("otpauth://totp/JR%20Logistics%3Aa%40b.test?secret=ABC&issuer=JR%20Logistics&algorithm=SHA1&digits=6&period=30");
  });
  it("secrets are encrypted at rest and tamper-evident; the login proof is signed and expiring", () => {
    const sealed = sealSecret(rfcSecret);
    expect(sealed).not.toContain(rfcSecret.toString("base64url"));
    expect(openSecret(sealed).equals(rfcSecret)).toBe(true);
    const bad = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => openSecret(bad)).toThrow();
    const tok = signMfaToken("user-1");
    expect(readMfaToken(tok)).toBe("user-1");
    const [body, sig] = tok.split(".");
    expect(() => readMfaToken(`${Buffer.from(JSON.stringify({ u: "other", exp: Date.now() + 1e6, k: "mfa" })).toString("base64url")}.${sig}`)).toThrow();
    expect(() => readMfaToken(body + ".x")).toThrow();
  });
});
