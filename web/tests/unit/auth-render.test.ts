import { describe, it, expect, vi } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";

/**
 * Render smoke test of the username + password screens (J1): the password and username boxes, the change-password screen and profile card, the credentials
 * card staff use, and the "sign-in details" screen after an account was created — in English, Arabic and Urdu, with no browser and no database. A missing
 * translation key, a raw {placeholder} or a crash shows up here.
 */
const fx: Record<string, unknown> = {};
vi.mock("@/components/ui/data", () => ({
  useApi: (path: string | null) => { const k = path ? Object.keys(fx).find((p) => path.startsWith(p)) : undefined; return { data: k ? fx[k] : undefined, error: undefined, mutate: () => {}, isLoading: false }; },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace() {}, push() {}, back() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: Record<string, unknown> & { children?: unknown }) => h("a", { href: href as string, ...p }, children as never) }));

import { PasswordField } from "@/components/auth/password-field";
import { UsernameField } from "@/components/auth/username-field";
import { ChangePasswordScreen, PasswordCard } from "@/components/auth/password-forms";
import { CredentialsCard } from "@/components/features/admin-credentials-card";
import { CreatedScreen } from "@/components/features/admin-create-credentials";

const DICT = { en, ar, ur };
const render = (el: ReactElement, locale: Locale = "en") => renderToStaticMarkup(h(I18nProvider, { locale, dict: DICT[locale], fallback: en, children: el }));
const clean = (html: string, where: string) => {
  expect(html, `${where}: raw keys`).not.toMatch(/\b(?:ja|auth|settings|staff|acr)\.[a-z_]+\b/);
  expect(html, `${where}: raw placeholders`).not.toMatch(/\{[a-z_]+\}/);
};
const noop = () => {};

describe("username + password screens render in every language", () => {
  for (const locale of ["en", "ar", "ur"] as const) {
    it(locale, () => {
      const pw = render(h(PasswordField, { label: DICT[locale]["auth.password"], value: "", onChange: noop, testId: "pw", extra: h("i") }), locale);
      expect(pw).toContain('data-testid="pw"'); expect(pw).toContain('type="password"'); expect(pw).toContain('aria-pressed="false"'); clean(pw, "password field");
      for (const state of ["idle", "checking", "available", "taken", "invalid", "reserved"] as const) {
        const u = render(h(UsernameField, { label: DICT[locale]["ja.username"], value: "abc", onChange: noop, state, testId: "reg-username" }), locale);
        expect(u).toContain('data-testid="reg-username"'); clean(u, `username ${state}`);
        if (state === "available") expect(u).toContain(DICT[locale]["ja.un_available"]);
        if (state === "taken") expect(u).toContain(DICT[locale]["ja.un_taken"]);
        if (state === "reserved") expect(u).toContain(DICT[locale]["ja.un_reserved"]);
      }
      const must = render(h(ChangePasswordScreen, { mustChange: true, home: "/business" }), locale);
      expect(must).toContain(DICT[locale]["ja.cp_temp_title"]); expect(must).toContain('data-testid="cp-current"'); expect(must).toContain('data-testid="cp-new"'); expect(must).toContain('data-testid="cp-confirm"'); clean(must, "must change");
      const voluntary = render(h(ChangePasswordScreen, { mustChange: false, home: "/driver" }), locale);
      expect(voluntary).toContain(DICT[locale]["ja.cp_title"]); clean(voluntary, "change password");
      const card = render(h(PasswordCard), locale);
      expect(card).toContain('data-testid="password-card"'); expect(card).toContain(DICT[locale]["ja.cp_card_title"]); clean(card, "profile card");
      const made = render(h(CreatedScreen, { name: "Alpha Co", openHref: "/admin/companies/1", username: "alpha.co", password: "Kx7m-Qw4t-Rn2p", generated: true, smsNote: null, onAnother: noop }), locale);
      expect(made).toContain("alpha.co"); expect(made).toContain("Kx7m-Qw4t-Rn2p"); expect(made).toContain(DICT[locale]["ja.cf_once"]); clean(made, "created screen");
    });
  }

  it("the credentials card shows the username and what is wrong with the password; it renders nothing without a response (no permission)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(render(h(CredentialsCard, { id }))).toBe("");
    fx[`/admin/users/${id}/credentials`] = { id, role: "driver", username: "demo.driver", hasPassword: false, mustChangePassword: true, failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000).toISOString(), status: "active" };
    for (const locale of ["en", "ar", "ur"] as const) {
      const html = render(h(CredentialsCard, { id }), locale);
      expect(html).toContain("demo.driver"); expect(html).toContain('data-testid="cred-rename"'); expect(html).toContain('data-testid="cred-reset"');
      expect(html).toContain(DICT[locale]["ja.cred_no_password"]); expect(html).toContain(DICT[locale]["ja.cred_must_change"]); clean(html, `credentials card ${locale}`);
    }
    delete fx[`/admin/users/${id}/credentials`];
  });
});
