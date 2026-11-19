/**
 * Pure helpers of the settings workspace: which platform settings belong to which sub-page, the patch each page saves,
 * and client-side range checks that mirror the API schema (`PATCH /admin/settings`). Unit-tested in tests/unit/admin-system-settings.test.ts.
 */
import { FIELDOPS_BOOL_KEYS, FIELDOPS_NUM_KEYS, buildSettingsPatch, fieldopsErrors } from "./admin-fieldops-lib";

/** Every platform setting the console edits, by sub-page. The sub-pages are routes under /admin/settings (see SETTINGS_TABS). */
export const SETTINGS_SECTIONS = {
  general: ["enabledServices", "cities"],
  jobs: ["lateGraceMin", "checkinEarlyMin", "overlapPolicy", "requireBusinessVerification", "requireDriverVerification", "cancelPolicyEnabled", "cancelWarnAt", "cancelSuspendAt", "cancelWindowDays", "cancelSuspendDays"],
  fieldops: [...FIELDOPS_BOOL_KEYS, ...FIELDOPS_NUM_KEYS, "warehouseDefaults"],
  finance: ["vatPct", "minWithdrawalCents"],
  security: ["requireStaffMfa"],
  terms: ["termsVersion", "termsBusiness", "termsDriver", "termsOffice"],
} as const satisfies Record<string, readonly string[]>;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const SETTINGS_ORDER = Object.keys(SETTINGS_SECTIONS) as SettingsSection[];
/** Route of each sub-page (the first one is /admin/settings itself). */
export const SETTINGS_PATH: Record<SettingsSection, string> = {
  general: "/admin/settings", jobs: "/admin/settings/jobs", fieldops: "/admin/settings/field-operations", finance: "/admin/settings/finance", security: "/admin/settings/security", terms: "/admin/settings/terms",
};
export const sectionOfKey = (key: string): SettingsSection | null => SETTINGS_ORDER.find((s) => (SETTINGS_SECTIONS[s] as readonly string[]).includes(key)) ?? null;

/** [min, max] the API accepts for each numeric setting that the legacy form edits (`minWithdrawalCents` is in halalas). */
export const SETTINGS_RANGES: Record<string, { min: number; max: number; int: boolean }> = {
  vatPct: { min: 0, max: 30, int: false }, minWithdrawalCents: { min: 0, max: 1_000_000_000, int: true },
  cancelWarnAt: { min: 1, max: 20, int: true }, cancelSuspendAt: { min: 1, max: 30, int: true }, cancelWindowDays: { min: 1, max: 90, int: true }, cancelSuspendDays: { min: 1, max: 90, int: true },
  lateGraceMin: { min: 0, max: 240, int: true }, checkinEarlyMin: { min: 0, max: 1440, int: true },
};
/** Fields of the edits whose value the API would reject (a number outside its range, not a number, or a fraction where a whole number is needed). */
export function rangeErrors(edits: Record<string, unknown>): Record<string, "range"> {
  const out: Record<string, "range"> = {};
  for (const [k, r] of Object.entries(SETTINGS_RANGES)) {
    if (!(k in edits)) continue;
    const n = Number(edits[k]);
    if (!Number.isFinite(n) || n < r.min || n > r.max || (r.int && !Number.isInteger(n))) out[k] = "range";
  }
  return out;
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface SectionState { patch: Record<string, unknown>; errors: Record<string, "range">; touched: boolean; dirty: boolean; invalid: boolean }
/**
 * The state of one sub-page's unsaved edits. `patch` is exactly what its Save sends (only keys of that page, only values that differ from
 * the server — field-operations values are normalised the same way the legacy form did). `touched` = something was edited (even back to the
 * stored value), `dirty` = Save would change something, `invalid` = a field is out of range (Save disabled).
 */
export function sectionState(server: Record<string, unknown> | null | undefined, edits: Record<string, unknown>, section: SettingsSection): SectionState {
  const keys = SETTINGS_SECTIONS[section] as readonly string[];
  const own = Object.fromEntries(Object.entries(edits).filter(([k]) => keys.includes(k)));
  const touched = Object.keys(own).length > 0;
  const errors: Record<string, "range"> = { ...fieldopsErrors(own), ...rangeErrors(own) };
  if (!server || !touched) return { patch: {}, errors, touched, dirty: false, invalid: Object.keys(errors).length > 0 };
  const full = buildSettingsPatch(server, own);
  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    if (!(k in full)) continue;
    const legacy = !(FIELDOPS_BOOL_KEYS as readonly string[]).includes(k) && !(FIELDOPS_NUM_KEYS as readonly string[]).includes(k) && k !== "warehouseDefaults";
    if (!legacy || (k in own && !sameJson(own[k], server[k]))) patch[k] = full[k];
  }
  // A city list the user edited is sent whole; the legacy form did the same.
  return { patch, errors, touched, dirty: Object.keys(patch).length > 0, invalid: Object.keys(errors).length > 0 };
}
/** The edits without the keys of one sub-page (after Save or Discard). */
export function withoutSection(edits: Record<string, unknown>, section: SettingsSection): Record<string, unknown> {
  const keys = SETTINGS_SECTIONS[section] as readonly string[];
  return Object.fromEntries(Object.entries(edits).filter(([k]) => !keys.includes(k)));
}
/** The sub-pages that have unsaved edits (for the dot on their tab). */
export const touchedSections = (edits: Record<string, unknown>): SettingsSection[] => SETTINGS_ORDER.filter((s) => (SETTINGS_SECTIONS[s] as readonly string[]).some((k) => k in edits));
