/** Audit K / A1 — pure pieces of the security fixes (the DB-backed ones are in tests/integration/audit-a1-access.test.ts). */
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { dummyPasswordHash, verifyAgainstDummy } from "@/server/auth/password";
import { maskPhoneUsername, usernameFromPhone } from "@/lib/username";

describe("the dummy password hash (sign-in for a name that does not exist)", () => {
  it("is a real bcrypt hash — the old constant was 67 characters, so compare() returned at once and the timing gave usernames away", async () => {
    const h = await dummyPasswordHash();
    expect(h).toHaveLength(60);
    expect(h).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(bcrypt.getRounds(h)).toBeGreaterThanOrEqual(4);
    expect(await dummyPasswordHash()).toBe(h); // computed once
    expect(await verifyAgainstDummy("anything")).toBe(false);
    expect(await bcrypt.compare("anything", h)).toBe(false);
  });
});

describe("phone-shaped usernames are masked like the phone", () => {
  it("masks u + digits, leaves chosen names alone", () => {
    expect(maskPhoneUsername(usernameFromPhone("+966500000001"))).toBe("u••••••••••01");
    expect(maskPhoneUsername("u966500000001")).not.toContain("9665");
    expect(maskPhoneUsername("demo.driver")).toBe("demo.driver");
    expect(maskPhoneUsername("u1234")).toBe("u1234"); // too short to be a phone
    expect(maskPhoneUsername("user966500000001")).toBe("user966500000001");
    expect(maskPhoneUsername(null)).toBeNull();
    expect(maskPhoneUsername(undefined)).toBeUndefined();
  });
});
