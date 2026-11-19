"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { Button, ErrorState, LinkTabs, Notice, PageHeader, PageLoading, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, patch } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { SETTINGS_ORDER, SETTINGS_PATH, sectionState, touchedSections, withoutSection, type SectionState, type SettingsSection } from "./admin-system-settings-lib";
import { cityProblems } from "./admin-cities";

interface Ctx {
  data: Record<string, any> | null; error: unknown; reload: () => void; edits: Record<string, unknown>; canEdit: boolean; saving: SettingsSection | null;
  /** Server value overlaid with the unsaved edit. */
  f: Record<string, any> | null; set: (k: string, v: unknown) => void;
  state: (s: SettingsSection) => SectionState; save: (s: SettingsSection) => void; discard: (s: SettingsSection) => void;
}
const SettingsCtx = createContext<Ctx | null>(null);
export function useSettings(): Ctx { const c = useContext(SettingsCtx); if (!c) throw new Error("useSettings outside the settings layout"); return c; }

const TAB_KEY: Record<SettingsSection, string> = { general: "rdb.set_tab_general", jobs: "rdb.set_tab_jobs", fieldops: "foa.set_title", finance: "rdb.set_tab_finance", security: "rdb.set_tab_security", terms: "rdb.set_tab_terms" };

/**
 * Shared frame of the settings workspace (`/admin/settings/*`): title, tab bar of route-based sub-pages, and the state every sub-page uses —
 * the saved settings plus the unsaved edits. The state lives in the layout, so edits survive moving between tabs; each tab saves only its own settings.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const sp = useSearchParams();
  const { data, error, mutate } = useApi<Record<string, any>>("/admin/settings", { shouldRetryOnError: false });
  const [edits, setEdits] = useState<Record<string, unknown>>({}); const [saving, setSaving] = useState<SettingsSection | null>(null);
  const touched = touchedSections(edits);
  // Leaving the page with unsaved policy changes would silently lose them.
  useEffect(() => {
    if (!touched.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [touched.length]);
  const state = (s: SettingsSection) => sectionState(data, edits, s);
  const ctx: Ctx = {
    data: data ?? null, error, reload: () => { void mutate(); }, edits, saving, canEdit: hasPerm(me, "settings.edit"), f: data ? { ...data, ...edits } : null,
    set: (k, v) => setEdits((p) => ({ ...p, [k]: v })), state,
    discard: (s) => setEdits((p) => withoutSection(p, s)),
    save: (s) => { const { patch: body } = state(s); setSaving(s); void a.run("s", () => patch("/admin/settings", body), { success: "common.saved", onDone: () => { setEdits((p) => withoutSection(p, s)); void mutate(); } }).finally(() => setSaving(null)); },
  };
  return (
    <SettingsCtx.Provider value={ctx}>
      <PageHeader title={t("nav.settings")} subtitle={t("settings.sub")} icon={<Settings className="size-5" />} />
      {(sp.get("change_password") || me.mustChangePassword) && <div className="mb-5"><Notice tone="warn" title={t("settings.must_change")}>{t("settings.must_change_body")}</Notice></div>}
      <LinkTabs label={t("nav.settings")} tabs={SETTINGS_ORDER.map((s) => ({ href: SETTINGS_PATH[s], label: t(TAB_KEY[s]),
        icon: touched.includes(s) ? <span className="size-2 rounded-full bg-gold" role="img" aria-label={t("uxa.unsaved_changes")} data-testid={`rdb-set-dirty-${s}`} /> : undefined }))} />
      {children}
    </SettingsCtx.Provider>
  );
}

/** Sticky Save / Discard bar of one sub-page; Save sends only that page's changes (`PATCH /admin/settings`). */
function SaveBar({ section, blocked }: { section: SettingsSection; blocked?: boolean }) {
  const { t } = useI18n(); const c = useSettings(); const s = c.state(section); const saving = c.saving === section;
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center gap-3 rounded-card border border-line bg-card/95 px-4 py-3 backdrop-blur">
      <Button size="lg" loading={saving} disabled={!s.dirty || s.invalid || !!blocked || c.saving !== null} onClick={() => c.save(section)} data-testid="foa-settings-save">{t("common.save")}</Button>
      {s.touched && <Button size="lg" variant="ghost" disabled={saving} onClick={() => c.discard(section)} data-testid="rdb-set-discard">{t("uxa.discard_changes")}</Button>}
      <span role="status" className={`text-sm ${s.touched ? "text-gold" : "text-muted"}`}>{s.touched ? t("uxa.unsaved_changes") : t("uxa.all_saved")}</span>
    </div>
  );
}

/** Body of one sub-page: the content with loading / error / forbidden states and its Save bar. `before` is shown whatever the state (the Security page's own-password card works without settings access). */
export function SettingsPage({ section, children, before, ownerNote = true }: { section: SettingsSection; children: ReactNode; before?: ReactNode; ownerNote?: boolean }) {
  const { t } = useI18n(); const c = useSettings();
  const body = c.error ? (c.error instanceof ApiError && c.error.code === "FORBIDDEN" ? <Notice tone="info">{t("err.FORBIDDEN")}</Notice> : <ErrorState error={c.error} retry={c.reload} />)
    : !c.f ? <PageLoading /> : (
      <>
        {ownerNote && <Notice tone="warn">{t("settings.owner_note")}</Notice>}
        {children}
        {c.canEdit ? <SaveBar section={section} blocked={section === "general" && cityProblems(c.f.cities ?? []).length > 0} /> : <Notice tone="info">{t("rdb.set_readonly")}</Notice>}
      </>);
  return <div className="space-y-5">{before}{body}</div>;
}
