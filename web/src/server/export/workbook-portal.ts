import type { User } from "@/db/schema";
import { audit } from "../audit";
import { officeOverviewReport } from "../analytics/portal-office";
import { collectPortalTable, getPortalTable } from "../analytics/portal-registry";
import { portalCtx } from "../analytics/portal-scope";
import { localeOf, namesOf, translator } from "./context";
import { assembleWorkbook, MAX_SHEET_ROWS, type TableSource } from "./workbook-core";
import { XLSX_MIME } from "./xlsx";

/**
 * `GET /office/analytics/workbook?<period filters>&lang=` — the signed-in courier office's own workbook (Summary, Daily, Drivers, Money, Money by day, Jobs, Earnings, Failures, Notes;
 * tables the office portal does not offer yet are left out). The owner is the SESSION (`portalCtx` drops any client-supplied office; a `driver` filter only keeps the office's own drivers),
 * so an office can only ever export itself. Audited as `report.export` with `{ workbook: "office", id }`.
 */
export async function portalOfficeWorkbook(user: User, query: URLSearchParams): Promise<Response> {
  const tr = translator(localeOf(query, user));
  const c = await portalCtx(user, query, "office");
  const withDriver = (id: string) => { const q = new URLSearchParams(query); q.set("driver", id); return q; };
  const source: TableSource = {
    table(_report, name) {
      const def = getPortalTable("office", name);
      if (!def) return undefined;
      return {
        title: def.title, columns: def.columns,
        fetch: async (driverId) => { const r = await collectPortalTable(def, driverId ? await portalCtx(user, withDriver(driverId), "office") : c); return { rows: r.rows, truncated: r.truncated }; },
      };
    },
  };
  const [overview, names] = await Promise.all([officeOverviewReport(user, query), namesOf("office", [user.id])]);
  const name = names.get(user.id) ?? user.name;
  const built = await assembleWorkbook({
    tr, source, kind: "office", report: "portal-office", dailyReport: "daily", summary: overview.kpis, filters: c.f, skipFilters: ["company", "office"],
    title: name, facts: [[tr("fr.xl_report"), tr("fr.xl_report_portal_office")], [tr("fr.xl_entity_office"), name]], moneyHidden: false,
  });
  await audit(user, "report.export", "report", `workbook/office/${user.id}`, { workbook: "office", id: user.id, format: "xlsx", sheets: built.sheets, truncated: built.truncated, filters: c.f.canonical, maxRows: MAX_SHEET_ROWS });
  return new Response(new Uint8Array(built.file), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="office-${user.id.slice(0, 8)}-${c.f.cur.from}_${c.f.cur.to}.xlsx"`, "cache-control": "no-store" } });
}
