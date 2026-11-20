"use client";
import { useI18n } from "@/i18n/provider";
import { DrillTable } from "../DrillTable";
import { PortalDrillTable } from "../portal/PortalDrillTable";
import { DownloadMenu } from "./DownloadMenu";
import { tableDownload, type Format, type TableRef } from "./fleet-lib";
import type { Downloader } from "./useDownload";

/**
 * One registered drill-down table (server-paged, sortable) with the Download menu in its header: the platform table `GET /admin/analytics/:report/table/:name` or the owner's
 * `GET /office/analytics/table/:name`. `qs` is the whole query (period, comparison and the entity or the report-page filters); the files are the same query with `format=`.
 */
export function FleetTable({ tref, qs, canExport, dl, pageSize, testId, fileBase }: { tref: TableRef; qs: string; canExport: boolean; dl: Downloader; pageSize?: number; testId: string; fileBase: string }) {
  const { locale } = useI18n();
  const menu = <DownloadMenu href={(f: Format) => tableDownload(tref, qs, f, locale)} busy={dl.busy} run={dl.run} canExport={canExport} fileBase={fileBase} />;
  return tref.portal
    ? <PortalDrillTable role="office" name={tref.name} qs={qs} testId={testId} pageSize={pageSize} actions={menu} csv={false} />
    : <DrillTable report={tref.report} name={tref.name} qs={qs} testId={testId} pageSize={pageSize} actions={menu} csv={false} />;
}
