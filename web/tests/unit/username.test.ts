import { describe, it, expect } from "vitest";
import { USERNAME_RE, RESERVED_USERNAMES, normalizeUsername, usernameFromEmail, usernameFromPhone, usernameProblem } from "@/lib/username";
import { generatePassword as serverGenerate, passwordProblem } from "@/server/auth/password";
import { generatePassword as clientGenerate, passwordIssue } from "@/lib/gen-password";

describe("username rules (J1)", () => {
  it("accepts 3–30 characters of a-z 0-9 . _ - starting with a letter or digit", () => {
    for (const u of ["abc", "a.b", "9lives", "demo.business", "u966500000001", "a-b_c.d", "x".repeat(30)]) expect(usernameProblem(u), u).toBeNull();
    expect(USERNAME_RE.test("x".repeat(30))).toBe(true);
  });
  it("refuses everything else as invalid", () => {
    for (const u of ["", "ab", "x".repeat(31), "UPPER", "has space", "-start", ".start", "_start", "name@host", "emoji😀", "عربي", "a/b", "a\nb"]) expect(usernameProblem(u), JSON.stringify(u)).toBe("invalid");
  });
  it("refuses reserved words", () => {
    for (const u of RESERVED_USERNAMES.filter((r) => USERNAME_RE.test(r))) expect(usernameProblem(u), u).toBe("reserved");
    expect(RESERVED_USERNAMES).toEqual(expect.arrayContaining(["admin", "root", "support", "staff", "system"]));
  });
  it("normalises: trim, lower-case, full-width letters folded", () => {
    expect(normalizeUsername("  Demo.Driver  ")).toBe("demo.driver");
    expect(normalizeUsername("ＡＢＣ１２３")).toBe("abc123");
    expect(normalizeUsername(undefined as never)).toBe("");
  });
  it("derives the default names the migration and the seeds use", () => {
    expect(usernameFromPhone("+966500000001")).toBe("u966500000001");
    expect(usernameFromEmail("Ops.Team+x@jr.com")).toBe("ops.teamx");
    expect(usernameFromEmail("hr@jr.com")).toBe("hruser");            // under three characters → padded
    expect(usernameFromEmail("__a@jr.com")).toBe("auser");            // leading punctuation dropped
    expect(usernameProblem(usernameFromEmail("a.very.long.mail.address.local.part@jr.com"))).toBeNull();
  });
});

describe("generated passwords", () => {
  it("server and browser generators always satisfy the password policy and look like Kx7m-Qw4t-Rn2p", () => {
    for (let i = 0; i < 300; i++) for (const g of [serverGenerate, clientGenerate]) {
      const p = g();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(passwordProblem(p)).toBeNull(); expect(passwordIssue(p)).toBeNull();
      expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect((p.match(/\d/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });
  it("are different every time", () => { expect(new Set(Array.from({ length: 200 }, serverGenerate)).size).toBe(200); });
  it("the browser rule agrees with the server rule", () => {
    for (const p of ["", "short1", "abcdefghijkl", "1234567890", "Abcdefghi1", "Test#Pass2026", "Password123"]) expect(passwordIssue(p) === null, p).toBe(passwordProblem(p) === null);
  });
});
