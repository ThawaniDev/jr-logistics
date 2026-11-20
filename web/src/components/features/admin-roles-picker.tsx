"use client";
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge, EmptyState, Notice, SearchBox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { searchPerms, setMany, togglePerm, type CatalogGroup, type Note } from "./admin-roles-lib";

export interface PickerProps {
  groups: CatalogGroup[]; value: string[]; onChange: (next: string[]) => void;
  /** Cannot be changed (a person who may look but not edit). */
  readOnly?: boolean;
  /** Permissions the signed-in person may add (they cannot grant what they do not hold themselves). Removing is always allowed. */
  grantable?: (perm: string) => boolean;
  /** Prefix of the test ids of the checkboxes (`<prefix>-<permission>`). */
  testIdPrefix?: string;
}

/**
 * The permission matrix of a role: groups by area with a select-all each, a search, "only selected", sensitive marks and a visible note whenever
 * ticking one permission also ticked what it needs (or unticking one also cleared what needs it). Every checkbox has its label and description.
 */
export function PermissionPicker({ groups, value, onChange, readOnly, grantable, testIdPrefix = "rj-perm" }: PickerProps) {
  const { t } = useI18n();
  const [q, setQ] = useState(""); const [only, setOnly] = useState(false); const [note, setNote] = useState<Note | null>(null);
  const label = (p: string) => t(`rjp.${p}`); const desc = (p: string) => t(`rjp.${p}.d`);
  const all = useMemo(() => groups.flatMap((g) => g.permissions.map((p) => p.key)), [groups]);
  const matches = useMemo(() => new Set(searchPerms(all, q, label, desc)), [all, q, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = (p: string) => !grantable || grantable(p);
  const apply = (r: { next: string[]; note: Note }) => { onChange(r.next); setNote(r.note.added.length || r.note.removed.length ? r.note : null); };
  const names = (ps: string[]) => ps.map(label).join(", ");
  const shown = groups.map((g) => ({ ...g, permissions: g.permissions.filter((p) => matches.has(p.key) && (!only || value.includes(p.key))) })).filter((g) => g.permissions.length > 0);

  return (
    <div className="space-y-4" data-testid="rj-picker">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-full sm:w-72"><SearchBox value={q} onChange={setQ} placeholder={t("rj.search")} label={t("rj.search")} testId="rj-search" /></div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" data-testid="rj-only-selected" className="size-4 accent-[var(--jr-accent)]" checked={only} onChange={(e) => setOnly(e.target.checked)} />{t("rj.only_selected")}</label>
        <p className="ms-auto text-xs text-muted" role="status" data-testid="rj-selected-count"><span className="ltr-num tabular-nums">{t("rj.selected_n", { a: value.length, b: all.length })}</span></p>
      </div>
      <div aria-live="polite" data-testid="rj-dep-note">
        {note && <Notice tone="info">
          {note.added.length > 0 && <p>{t("rj.dep_added", { list: names(note.added) })}</p>}
          {note.removed.length > 0 && <p>{t("rj.dep_removed", { list: names(note.removed) })}</p>}
        </Notice>}
      </div>
      {shown.length === 0 ? <EmptyState title={t("rj.none_match")} hint={t("rj.none_match_hint")} /> : (
        <div className="space-y-4">{shown.map((g) => {
          const keys = groups.find((x) => x.id === g.id)!.permissions.map((p) => p.key); const scope = g.permissions.map((p) => p.key); // select-all acts on what is shown (a search narrows it)
          const on = keys.filter((k) => value.includes(k)).length;
          const addable = scope.filter((k) => value.includes(k) || can(k)); const allOn = addable.length > 0 && addable.every((k) => value.includes(k));
          return (
            <section key={g.id} role="group" aria-labelledby={`rj-g-${g.id}`} data-testid={`rj-group-${g.id}`} className="overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-bg2/60 px-3 py-2">
                <h3 id={`rj-g-${g.id}`} className="text-sm font-semibold">{t(`rj.group_${g.id}`)} <span className="ltr-num ms-1 text-xs font-normal tabular-nums text-muted">{on}/{keys.length}</span></h3>
                {!readOnly && <button type="button" data-testid={`rj-group-all-${g.id}`} aria-label={t(allOn ? "rj.clear_group_aria" : "rj.select_group_aria", { group: t(`rj.group_${g.id}`) })} disabled={addable.length === 0}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40" onClick={() => apply(allOn ? setMany(value, scope, false) : setMany(value, addable, true))}>{t(allOn ? "rj.clear" : "rj.select_all")}</button>}
              </div>
              <ul className="grid sm:grid-cols-2">{g.permissions.map((p) => {
                const checked = value.includes(p.key); const locked = readOnly || (!checked && !can(p.key));
                return (
                  <li key={p.key}>
                    <label className={cn("flex h-full items-start gap-3 px-3 py-2.5", locked ? "cursor-default" : "cursor-pointer hover:bg-bg2/60", checked && "bg-accent/5", !readOnly && locked && "opacity-60")} title={!readOnly && locked ? t("rj.not_grantable") : undefined}>
                      <input type="checkbox" data-testid={`${testIdPrefix}-${p.key}`} className="mt-1 size-4 shrink-0 accent-[var(--jr-accent)]" checked={checked} disabled={locked} onChange={(e) => apply(togglePerm(value, p.key, e.target.checked))} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-ink">{label(p.key)}</span>
                          {p.sensitive && <span title={t("rj.sensitive_hint")}><Badge tone="warn"><AlertTriangle className="size-3" aria-hidden />{t("rj.sensitive")}</Badge></span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">{desc(p.key)}</span>
                        <span className="mt-0.5 block text-[11px] text-muted/80"><span className="ltr-num" dir="ltr">{p.key}</span>{p.requires.length > 0 && <> · {t("rj.requires", { list: names(p.requires) })}</>}</span>
                      </span>
                    </label>
                  </li>);
              })}</ul>
            </section>);
        })}</div>)}
    </div>
  );
}
