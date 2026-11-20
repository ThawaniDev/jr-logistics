import type { Dict } from "../core";
import { rowsA, type Row } from "./rd-detail-3a";
import { rowsB } from "./rd-detail-3b";
import { rowsC } from "./rd-detail-3c";
import { rowsD } from "./rd-detail-3d";

/**
 * Platform data / reports / detail views — Company, user, ticket and complaint detail views. Every key starts with `dv3.`; en, ar and ur are built from the same rows
 * (`rd-detail-3a…d.ts`), so a key can never exist in one language only.
 */
const rows: Row[] = [...rowsA, ...rowsB, ...rowsC, ...rowsD];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const DV3_ROWS = rows;
