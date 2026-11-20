import { describe, it, expect } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/components/layout/auth-context";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";
import type { ActivityItem } from "@/server/activity-core";
import { ACTIVITY_KINDS } from "@/server/activity-core";
import { SHIPMENT_EVENT_TYPES } from "@/server/shipment-events";
import { KNOWN_AUDIT_ACTIONS } from "@/server/activity-sources";
import { ActivityRow } from "@/components/features/activity-item";
import { ActivityLog } from "@/components/features/activity-log";
import { ActivityLogView, type ActivityViewProps } from "@/components/features/activity-view";
import { NO_FILTERS } from "@/components/features/activity-lib";
import { NotesPanel } from "@/components/features/notes-panel";
import { JsonView, RawDataPanel } from "@/components/features/activity-raw";
import { renderTitle } from "@/components/features/activity-lib";
import { translate } from "@/i18n/core";

const DICT = { en, ar, ur };
const wrap = (el: ReactElement, locale: Locale = "en") => renderToStaticMarkup(h(AuthProvider, { user: { id: "u", role: "admin", name: "Admin", permissions: [] } as never, children: h(I18nProvider, { locale, dict: DICT[locale], fallback: en, children: el }) }));
const item = (o: Partial<ActivityItem> = {}): ActivityItem => ({ id: "1", at: "2026-11-19T10:00:00.000Z", kind: "parcel", source: "events", table: "shipment_events", titleKey: "dtk.p_delivered", params: { code: "JR-000001-001" }, actor: { id: "d1", name: "Sam Driver", role: "driver" }, refs: [{ type: "request", id: "r1", label: "JR-000001" }, { type: "offer", id: "o1" }], details: { proofType: "otp", distanceM: 12 }, ...o });

const result = (o: Record<string, unknown> = {}) => ({ items: [], total: 3, page: 1, pageSize: 30, kindCounts: { parcel: 2, chat: 1 }, hidden: [], failed: [], truncated: false, entity: { type: "request", id: "r1", label: "JR-1" }, ...o }) as never;
const view = (o: Partial<ActivityViewProps> = {}, locale: Locale = "en") => wrap(h(ActivityLogView, {
  title: "Activity", first: result(), items: [item(), item({ id: "3", titleKey: "dtk.p_failed", params: { code: "A", reason: "refused" } }), item({ id: "2", at: "2026-11-18T10:00:00.000Z", kind: "chat", table: "messages", titleKey: "dtk.chat_message", params: { role: "business", text: "Hi" } })],
  total: 3, pages: 1, loading: false, error: null, validating: false, filters: NO_FILTERS, qInput: "", actors: { d1: "Sam Driver" }, chips: ["parcel", "chat"], canExport: true, exportHref: "/api/v1/admin/activity/request/r1/export",
  onClearKinds() {}, onToggleKind() {}, onQ() {}, onActor() {}, onFrom() {}, onTo() {}, onClear() {}, onMore() {}, onRetry() {}, ...o,
}), locale);

describe("activity components render", () => {
  it("the log view: chips with counts, filters, day groups, export link, count — and no load-more when everything is shown", () => {
    const html = view();
    expect(html).toContain('data-testid="dtk-chip-all"'); expect(html).toContain('data-testid="dtk-chip-parcel"'); expect(html).toContain("Parcels"); expect(html).toContain("Chat");
    expect(html).toContain('data-testid="dtk-search"'); expect(html).toContain('data-testid="dtk-actor"'); expect(html).toContain("Sam Driver"); expect(html).toContain('data-testid="dtk-from"'); expect(html).toContain('data-testid="dtk-to"');
    expect(html).toContain('href="/api/v1/admin/activity/request/r1/export"'); expect(html).toContain("Showing 3 of 3"); expect(html).not.toContain('data-testid="dtk-more"'); expect(html).not.toContain('data-testid="dtk-clear"');
    expect((html.match(/data-testid="dtk-item"/g) ?? []).length).toBe(3); expect((html.match(/<h3/g) ?? []).length).toBe(2); // two Riyadh days
    expect(html).toContain('aria-pressed="true"'); // "All" is the selected chip
  });
  it("shows what is hidden or failed, offers load more while there is more, and the filtered / error / empty states", () => {
    expect(view({ first: result({ hidden: ["finance", "audit"] }) })).toContain("money movements, the audit log");
    expect(view({ first: result({ failed: ["ledger_entries"] }) })).toContain("ledger_entries");
    const more = view({ total: 50, first: result({ total: 50 }) });
    expect(more).toContain('data-testid="dtk-more"'); expect(more).toContain("Showing 3 of 50");
    expect(view({ total: 50, pages: 20, first: result({ total: 50 }) })).not.toContain('data-testid="dtk-more"');
    const empty = view({ items: [], total: 0, filters: { ...NO_FILTERS, q: "zzz" } });
    expect(empty).toContain('data-testid="dtk-empty"'); expect(empty).toContain(en["dtk.empty_filtered"]); expect(empty).toContain('data-testid="dtk-clear"');
    expect(view({ items: [], total: 0 })).toContain(en["dtk.empty"]);
    expect(view({ first: undefined, loading: true })).toContain('data-testid="dtk-loading"');
    expect(view({ first: undefined, loading: false, error: new Error("boom") })).toContain('role="alert"');
    const compact = view({ compact: true });
    expect(compact).not.toContain("dtk-search"); expect(compact).not.toContain("dtk-chip-all"); expect(compact).toContain('data-testid="dtk-item"');
    expect(view({ canExport: false })).not.toContain("dtk-export");
  });
  it("the log view works in Arabic: translated chips and headings, no leftover keys", () => {
    const html = view({}, "ar");
    expect(html).toContain("الطرود"); expect(html).toContain("المحادثة"); expect(html).toContain("تصدير CSV"); expect(html).toContain("عرض 3 من 3");
    expect(html).not.toMatch(/>[^<]*\b(dtk|notif|event)\.[a-z_]/); expect(view({ first: result({ hidden: ["finance"] }) }, "ar")).toContain("الحركات المالية");
  });
  it("a timeline row: translated title, who and when, links to what it mentions, details toggle, kind marker", () => {
    const html = wrap(h(ActivityRow, { item: item() }));
    expect(html).toContain("JR-000001-001 delivered"); expect(html).toContain("Sam Driver"); expect(html).toContain("(Driver)");
    expect(html).toContain('href="/admin/requests/r1"'); expect(html).toContain("JR-000001"); expect(html).toContain('data-kind="parcel"'); expect(html).toContain('data-testid="dtk-item-toggle"');
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain("dtk-item-details"); expect(html).toMatch(/bg-accent\/10 text-accent/);
    expect(html).toContain('dateTime="2026-11-19T10:00:00.000Z"');
  });
  it("problems are red, system events say so, rows without details have no toggle", () => {
    expect(wrap(h(ActivityRow, { item: item({ titleKey: "dtk.p_failed", params: { code: "A", reason: "refused" } }) }))).toMatch(/bg-danger\/10 text-danger/);
    const sys = wrap(h(ActivityRow, { item: item({ kind: "event", table: "job_events", titleKey: "event.request_published", params: {}, actor: { id: null, name: null, role: "system" }, details: null, refs: [] }) }));
    expect(sys).toContain(en["event.request_published"]); expect(sys).toContain(en["dtk.by_system"]); expect(sys).not.toContain("dtk-item-toggle");
  });
  it("Arabic and Urdu rows are right-to-left safe: logical classes only, translated, no leftover keys or placeholders", () => {
    for (const l of ["ar", "ur"] as const) {
      const html = wrap(h(ActivityRow, { item: item() }), l);
      expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/); expect(html).not.toMatch(/>[^<]*\b(dtk|notif|event)\.[a-z_]/); expect(html).not.toMatch(/\{\w+\}/); // no raw key / open placeholder in any visible text
      expect(html).toContain("JR-000001-001");
    }
    expect(wrap(h(ActivityRow, { item: item() }), "ar")).toContain("تم تسليم JR-000001-001");
  });
  it("every title key renders in every language without a raw key or an open placeholder (missing values show a dash)", () => {
    const keys = [...SHIPMENT_EVENT_TYPES.map((t) => `dtk.p_${t}`), ...KNOWN_AUDIT_ACTIONS.map((a) => `dtk.act.${a}`), "dtk.audit_action", "dtk.chat_message", "dtk.login_ok", "dtk.login_failed", "dtk.message_failed", "dtk.webhook_dead_letter", "dtk.rating_c", "dtk.ticket_opened", "dtk.complaint_filed", "dtk.cod_remitted"];
    for (const l of ["en", "ar", "ur"] as const) {
      const t = (k: string, v?: Record<string, string | number>) => translate(DICT[l], en, k, v);
      for (const k of keys) { const s = renderTitle(item({ titleKey: k, params: {} }), t, l); expect(s, `${l} ${k}`).not.toMatch(/\{\w+\}|^dtk\./); expect(s.length, `${l} ${k}`).toBeGreaterThan(3); }
    }
  });
  it("the log shows its loading state and test ids before data arrives; every kind has an icon", () => {
    const html = wrap(h(ActivityLog, { entity: "request", id: "00000000-0000-4000-8000-000000000000" }));
    expect(html).toContain('data-testid="dtk-log"'); expect(html).toContain('data-testid="dtk-loading"'); expect(html).toContain(en["dtk.title"]);
    expect(wrap(h(ActivityLog, { entity: "user", id: "x", compact: true, title: "Recent" }))).toContain("Recent");
    expect(ACTIVITY_KINDS.length).toBe(14);
  });
  it("the notes panel and the raw data panel render", () => {
    const notes = wrap(h(NotesPanel, { entity: "ticket", id: "t1" }));
    expect(notes).toContain('data-testid="dtk-notes"'); expect(notes).toContain(en["dtk.notes_title"]); expect(notes).toContain(en["dtk.notes_hint"]);
    const raw = wrap(h(RawDataPanel, { data: { id: "abc", n: 5, nested: { a: 1 } }, defaultOpen: true }));
    expect(raw).toContain(en["dtk.raw_title"]); expect(raw).toContain("abc"); expect(raw).toContain('aria-expanded="true"'); expect(raw).not.toContain("nested");
    expect(wrap(h(RawDataPanel, { data: { id: "abc" } }))).not.toContain("abc");
    const json = wrap(h(JsonView, { data: { a: [1, 2] } }));
    expect(json).toContain('dir="ltr"'); expect(json).toContain(en["dtk.copy"]);
  });
});
