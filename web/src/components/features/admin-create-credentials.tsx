"use client";
import Link from "next/link";
import { Copy, KeyRound, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Notice, Section } from "@/components/ui";
import { PasswordField } from "@/components/auth/password-field";
import { UsernameField, useUsernameCheck } from "@/components/auth/username-field";
import { generatePassword } from "@/lib/gen-password";
import { usernameFromPhone } from "@/lib/username";
import { useI18n } from "@/i18n/provider";
import { phoneOf } from "./admin-create-lib";
import type { Ctx } from "./admin-create-sections";

/** Copies text and says so. */
export function useCopy() {
  const { t } = useI18n();
  return (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success(t("common.copied")), () => {}); };
}

/** Create form: how the person signs in — a username (or the default) and a temporary password (typed, or generated here / by the server). They choose their own at the first sign-in. */
export function CredentialsSection({ c }: { c: Ctx }) {
  const { t } = useI18n(); const copy = useCopy();
  const phone = phoneOf(c.f.phone);
  const state = useUsernameCheck(c.f.username, { skip: !c.f.username.trim() });
  const gen = <button type="button" onClick={() => c.set("password", generatePassword())} aria-label={t("ja.cf_generate")} title={t("ja.cf_generate")} data-testid="acr-generate-password"
    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-accent pointer-coarse:size-10"><Wand2 className="size-4" aria-hidden /></button>;
  const cp = c.f.password ? <button type="button" onClick={() => copy(c.f.password)} aria-label={t("ja.cf_copy")} title={t("ja.cf_copy")} data-testid="acr-copy-password"
    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-ink pointer-coarse:size-10"><Copy className="size-4" aria-hidden /></button> : null;
  return (
    <Section title={t("ja.cf_title")} description={t("ja.cf_sub")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <UsernameField label={t("ja.username")} value={c.f.username} onChange={(v) => c.set("username", v)} state={state} error={c.errs.username} testId="acr-username" autoComplete="off"
          placeholder={phone ? usernameFromPhone(phone) : undefined} hint={t("ja.cf_username_hint")} />
        <PasswordField label={t("ja.cf_password")} value={c.f.password} onChange={(v) => c.set("password", v)} autoComplete="off" error={c.errs.password} hint={t("ja.cf_password_hint")} testId="acr-password" extra={<>{cp}{gen}</>} />
      </div>
    </Section>
  );
}

/** After the account exists: the sign-in details, shown now and never again (the password is stored only as a hash). */
export function CreatedScreen({ name, openHref, username, password, generated, smsNote, onAnother }: {
  name: string; openHref: string; username: string; password: string; generated: boolean; smsNote?: string | null; onAnother: () => void;
}) {
  const { t } = useI18n(); const copy = useCopy();
  const both = `${t("ja.username")}: ${username}\n${t("auth.password")}: ${password}`;
  const row = (label: string, value: string, id: string) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg2 px-4 py-3">
      <div className="min-w-0"><p className="text-xs text-muted">{label}</p><p className="break-all font-mono text-base font-semibold text-ink" dir="ltr" data-testid={id}>{value}</p></div>
      <Button type="button" variant="secondary" size="sm" onClick={() => copy(value)} aria-label={`${t("ja.cf_copy")} ${label}`}><Copy className="size-4" aria-hidden />{t("ja.cf_copy")}</Button>
    </div>
  );
  return (
    <div className="mx-auto max-w-xl space-y-4" data-testid="acr-created">
      <Notice tone="success" title={t("acr.created", { name })}>{t("ja.cf_created_note")}</Notice>
      <div className="space-y-3 rounded-card border border-line bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-accent" aria-hidden />{t("ja.cf_created_title")}</p>
        {row(t("ja.username"), username, "acr-created-username")}
        {row(t("auth.password"), password, "acr-created-password")}
        {generated && <p className="text-xs text-muted">{t("ja.cf_generated_note")}</p>}
        <p className="text-xs font-medium text-gold">{t("ja.cf_once")}</p>
        {smsNote && <p className="text-xs text-muted">{smsNote}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => copy(both)} data-testid="acr-created-copy-all"><Copy className="size-4" aria-hidden />{t("ja.cf_copy_both")}</Button>
          <Link href={openHref} className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110" data-testid="acr-open-created">{t("acr.open_created")}</Link>
          <Button type="button" variant="ghost" onClick={onAnother} data-testid="acr-created-another"><Plus className="size-4" aria-hidden />{t("acr.create_another")}</Button>
        </div>
      </div>
    </div>
  );
}
