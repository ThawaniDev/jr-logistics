import { describe, expect, it } from "vitest";
import { describeError, scrub } from "@/lib/log";

describe("log scrubbing", () => {
  it("drops the bound parameters of a failed statement", () => {
    expect(scrub('Failed query: update "users" set "iban" = $1\nparams: SA0380000000608010167519,+966555123456')).toBe('Failed query: update "users" set "iban" = $1');
  });

  it("redacts credentials that an HTTP client or a driver echoed into its message", () => {
    expect(scrub("request failed: authorization: Bearer abc123.def456")).not.toMatch(/abc123|def456/);
    expect(scrub("Authorization=Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    expect(scrub("upstream 401 for Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).not.toContain("eyJhbGci");
    expect(scrub("X-API-Key: jrk_live_abcdef and jrk_other_123")).not.toMatch(/abcdef|other_123/);
    expect(scrub("login failed password=hunter2 token: abc")).not.toMatch(/hunter2|abc/);
    expect(scrub('partner said {"api_key":"k-123456"}')).not.toContain("k-123456");
  });

  it("redacts the secret token of an inbound webhook URL", () => {
    const m = scrub("connect ECONNREFUSED https://jr.example.com/api/v1/integrations/hooks/conn-1/SUPERSECRETTOKEN?x=1");
    expect(m).not.toContain("SUPERSECRETTOKEN");
    expect(m).toContain("/integrations/hooks/conn-1/[redacted]");
  });

  it("redacts IBANs and Saudi mobile numbers wherever they appear", () => {
    const m = scrub("duplicate for SA0380000000608010167519 / +966555123456 / 0555123456 / 966 555123456");
    expect(m).not.toMatch(/SA03800|555123456|0555123/);
    expect(m).toContain("[iban]");
  });

  it("leaves ordinary text alone and caps the length", () => {
    expect(scrub("connect ECONNREFUSED 127.0.0.1:5432")).toBe("connect ECONNREFUSED 127.0.0.1:5432");
    expect(scrub("x".repeat(5000)).length).toBe(300);
    expect(describeError(new Error("Bearer abcdef123456")).message).toBe("Bearer [redacted]");
  });
});
