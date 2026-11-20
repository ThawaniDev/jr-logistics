import type { User } from "@/db/schema";
import "./fleet-tables-drivers";
import "./fleet-tables-offices";
import { getTable, type DrillDef } from "./registry";
import { definePortalTable } from "./portal-registry";

/**
 * The fleet report tables of the courier-office portal (`/office/analytics/table/:name`, contract memory/FLEET_REPORTS.md §4, decision I8): the SAME queries as the back-office
 * tables, run with the ownership filters `portalCtx()` forces (`office` = the signed-in office, `driver` only its own drivers), so the scope is the session and nothing else.
 *
 *  perf → drivers/perf · daily → offices/daily · money → drivers/money · money_daily → offices/money_daily · earnings → offices/earnings · failures → offices/failures
 *
 * The owner sees what the office earned, was paid and still holds in cash — never the customer price, the platform margin, VAT, refunds or adjustments (see `HIDDEN`), and not the
 * (always its own) office column. The admin queries decide "may this viewer see money" from the viewer's role; the owner is shown the money above, so the query runs as an admin viewer
 * and the hidden columns are removed here (also from the sort whitelist, so a hidden value cannot be inferred by sorting).
 */
const HIDDEN = new Set(["customerCents", "marginCents", "vatCents", "refundCents", "adjustCents", "office"]);
const AS_OWNER = (u: User): User => ({ ...u, role: "admin" });

function via(name: string, report: "drivers" | "offices", source: string): void {
  const def: DrillDef | undefined = getTable(report, source);
  if (!def) throw new Error(`fleet portal table ${name}: ${report}/${source} is not registered`);
  definePortalTable({
    portal: "office", name, title: def.title,
    columns: def.columns.filter((c) => !HIDDEN.has(c.key)),
    sorts: Object.fromEntries(Object.entries(def.sorts).filter(([k]) => !HIDDEN.has(k))),
    defaultSort: def.defaultSort, tiebreak: def.tiebreak!,
    query: async ({ c, limit, offset, order, sort }) => {
      const r = await def.query({ filters: c.f, user: AS_OWNER(c.user), limit, offset, order, sort });
      return { ...r, rows: r.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !HIDDEN.has(k)))) }; // the rows carry the hidden values too: drop them here, not only from the column list
    },
  });
}

via("perf", "drivers", "perf");
via("daily", "offices", "daily");
via("money", "drivers", "money");
via("money_daily", "offices", "money_daily");
via("earnings", "offices", "earnings");
via("failures", "offices", "failures");
