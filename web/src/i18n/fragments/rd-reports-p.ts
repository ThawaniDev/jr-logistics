import type { Dict } from "../core";
import * as cmp from "./rd-reports-p-cmp";
import * as drv from "./rd-reports-p-drv";
import * as off from "./rd-reports-p-off";
import * as gro from "./rd-reports-p-gro";
import * as tbl from "./rd-reports-p-tbl";
/**
 * Platform data / reports / detail views — Reports: companies, drivers, offices, growth. Every key starts with `rpp.`; en, ar and ur are added together.
 * The text lives in `rd-reports-p-*.ts` (one file per report plus the shared table columns, each kept small) and is merged here.
 */
export const en: Dict = { ...cmp.en, ...drv.en, ...off.en, ...gro.en, ...tbl.en };
export const ar: Dict = { ...cmp.ar, ...drv.ar, ...off.ar, ...gro.ar, ...tbl.ar };
export const ur: Dict = { ...cmp.ur, ...drv.ur, ...off.ur, ...gro.ur, ...tbl.ur };
