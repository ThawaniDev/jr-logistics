import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { officeProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "../audit";
import { can, requirePerm } from "../auth/permissions";
import { driversReport } from "../analytics/drivers";
import { parseFilters, type ResolvedFilters } from "../analytics/filters";
import { officesReport } from "../analytics/offices";
import { collectTable, getTable, shape } from "../analytics/registry";
import { localeOf, translator } from "./context";
import { assembleWorkbook, MAX_SHEET_ROWS, type EntityKind, type TableSource } from "./workbook-core";
import { XLSX_MIME } from "./xlsx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WORKBOOK_KINDS: readonly EntityKind[] = ["office", "driver"];

/** The query of the entity's report: its own id replaces any `office` / `driver` the caller sent (a driver's workbook has no office filter), `lang` / `format` are not filters. */
function scoped(query: URLSearchParams, kind: EntityKind, id: string): URLSearchParams {
  const q = new URLSearchParams(query);
  for (const k of ["lang", "format", "office", ...(kind === "driver" ? ["driver"] : [])]) q.delete(k);
  if (kind === "office") q.set("office", id); else q.set("driver", id);
  return q;
}
const forDriver = (query: URLSearchParams, id: string) => { const q = new URLSearchParams(query); q.delete("office"); q.set("driver", id); return q; };

function adminSource(user: User, f: ResolvedFilters, q: URLSearchParams): TableSource {
  return {
    table(report, name) {
      const def = getTable(report, name);
      if (!def || (def.needs ?? []).some((p) => !can(user, p))) return undefined; // not registered (yet) or not for this viewer: the sheet is simply left out
      const { columns } = shape(def, user);
      return {
        title: def.title, columns,
        fetch: async (driverId) => { const r = await collectTable(user, def, driverId ? parseFilters(forDriver(q, driverId)) : f); return { rows: r.rows, truncated: r.truncated }; },
      };
    },
  };
}

async function findEntity(kind: EntityKind, id: string): Promise<{ name: string }> {
  const missing = () => err("NOT_FOUND", kind === "office" ? "Courier office not found" : "Driver not found");
  if (!UUID.test(id)) throw missing();
  const label = kind === "office" ? sql<string>`coalesce(${officeProfiles.officeName}, ${users.name})` : sql<string>`${users.name}`;
  const [row] = await db.select({ name: label }).from(users).leftJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(and(eq(users.id, id), eq(users.role, kind))).limit(1);
  if (!row) throw missing();
  return row;
}

/**
 * `GET /admin/analytics/workbook/:kind/:id?<period filters>&lang=` — one office or driver as an Excel workbook: Summary (the KPIs with current / previous / change), then one sheet per
 * registered table of its report (Daily, Drivers, Money, Money by day, Jobs, Earnings, Failures; tables that do not exist yet or need money access are left out), then Notes.
 * Needs `reports.view` + `reports.export`; 404 for an unknown or wrong-role id; audited as `report.export` with `{ workbook, id }`.
 */
export async function entityWorkbook(user: User, kind: string, id: string, query: URLSearchParams): Promise<Response> {
  requirePerm(user, "reports.view");
  if (!(WORKBOOK_KINDS as readonly string[]).includes(kind)) throw err("NOT_FOUND", "Unknown workbook kind");
  const k = kind as EntityKind;
  requirePerm(user, "reports.export");
  const tr = translator(localeOf(query, user));
  const entity = await findEntity(k, id);
  const q = scoped(query, k, id), f = parseFilters(q);
  const report = k === "office" ? await officesReport(user, q) : await driversReport(user, q);
  const built = await assembleWorkbook({
    tr, source: adminSource(user, f, q), kind: k, report: k === "office" ? "offices" : "drivers", dailyReport: "drivers", summary: report.kpis, filters: f, skipFilters: [k],
    title: entity.name, facts: [[tr("fr.xl_report"), tr(`fr.xl_report_${k === "office" ? "offices" : "drivers"}`)], [tr(k === "office" ? "fr.xl_entity_office" : "fr.xl_entity_driver"), entity.name]],
    moneyHidden: !can(user, "finance.view"),
  });
  await audit(user, "report.export", "report", `workbook/${k}/${id}`, { workbook: k, id, format: "xlsx", sheets: built.sheets, truncated: built.truncated, filters: f.canonical, maxRows: MAX_SHEET_ROWS });
  return new Response(new Uint8Array(built.file), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="${k}-${id.slice(0, 8)}-${f.cur.from}_${f.cur.to}.xlsx"`, "cache-control": "no-store" } });
}
