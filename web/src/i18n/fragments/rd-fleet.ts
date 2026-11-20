import type { Dict } from "../core";
import { COL_ROWS, type FleetRow } from "./rd-fleet-cols";
import { HELP_ROWS } from "./rd-fleet-help";
import { KPI_ROWS } from "./rd-fleet-kpis";
import { NOTE_ROWS } from "./rd-fleet-notes";

/**
 * Fleet reports (drivers + courier offices) — tables, columns, help, KPIs and notes of `server/analytics/fleet-*.ts`. Every key starts with `fr.` (plus `stopfail.unknown`).
 * en, ar and ur are built from the same rows, so a key can never exist in one language only. The sub-files hold the rows by topic.
 */
const rows: FleetRow[] = [...COL_ROWS, ...HELP_ROWS, ...KPI_ROWS, ...NOTE_ROWS];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const FLEET_ROWS = rows;
