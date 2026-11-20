import { fleetNotes } from "../analytics/fleet-notes";
import type { ResolvedFilters } from "../analytics/filters";
import type { Tr } from "./context";
import type { XlType } from "./xlsx";

/**
 * The "how to read this" lines of an export (decision I6): `{ key, vars }[]` of i18n keys, localized by `noteLines()`.
 * Two sources: the generic lines that follow from what the sheets contain (dates, money, percentages … — `fr.xl_note_*`, owned by this module), and the report-specific lines of the
 * fleet reports (`fleetNotesFor` below, the adapter to `server/analytics/fleet-notes.ts`).
 */
export interface NoteLine { key: string; vars?: Record<string, string | number> }
export interface NoteScope {
  /** `drivers`, `offices`, … (admin) or `portal-office` / `portal-business`. */
  report: string;
  /** One table (`daily`, `perf` …); omitted for a workbook or for "all tables of the report". */
  table?: string;
  /** Set for an entity workbook. */
  workbook?: "office" | "driver";
  /** The Excel types present in the exported sheets: only the lines that explain something visible are included. */
  types: ReadonlySet<XlType>;
  /** The tables the export contains (`daily`, `perf` …): the fleet notes only explain those. */
  tables?: readonly string[];
  /** The filters of the export (the fleet notes quote the period and say which filters narrow what) and the late-grace setting. */
  filters?: ResolvedFilters;
  grace?: number;
  /** An export already prints the period and the comparison period on its Notes sheet: leave the fleet notes' own period lines out. */
  skipPeriod?: boolean;
  /** The viewer cannot see money (no `finance.view`): say why money is missing. */
  moneyHidden?: boolean;
  /** The workbook has a Summary sheet. */
  summary?: boolean;
}

/**
 * The report-specific lines: `fleetNotes()` of the fleet reports (`drivers`, `offices`; an office's own portal reads drivers' tables, so it gets the drivers' lines). Other reports have none.
 * Without `filters` there is nothing to quote the period from, so the lines are left out too.
 */
export function fleetNotesFor(s: NoteScope): NoteLine[] {
  const report = s.report === "drivers" || s.report === "offices" ? s.report : s.report === "portal-office" ? "drivers" : null;
  if (!report || !s.filters) return [];
  const lines = fleetNotes({ report, tables: s.tables, money: !s.moneyHidden }, s.filters, { grace: s.grace });
  return s.skipPeriod ? lines.filter((n) => n.key !== "fr.note_period" && n.key !== "fr.note_compare") : lines;
}

const has = (s: NoteScope, ...t: XlType[]) => t.some((x) => s.types.has(x));
/** Every note line of an export, in reading order: the report's own lines first, then the lines about units and formats. */
export function exportNotes(s: NoteScope): NoteLine[] {
  const out: NoteLine[] = [...fleetNotesFor(s)];
  out.push({ key: "fr.xl_note_tz" });
  if (s.summary) out.push({ key: "fr.xl_note_summary" });
  if (has(s, "money", "dmoney")) out.push({ key: "fr.xl_note_money" });
  out.push({ key: "fr.xl_note_empty" });
  if (has(s, "percent", "dpercent")) out.push({ key: "fr.xl_note_percent" });
  if (has(s, "duration")) out.push({ key: "fr.xl_note_duration" });
  if (has(s, "km")) out.push({ key: "fr.xl_note_km" });
  out.push({ key: "fr.xl_note_filters" });
  if (s.moneyHidden) out.push({ key: "fr.xl_note_hidden_money" });
  out.push({ key: "fr.xl_note_text" });
  return out;
}
export const noteLines = (tr: Tr, s: NoteScope): string[] => exportNotes(s).map((n) => tr(n.key, n.vars));
