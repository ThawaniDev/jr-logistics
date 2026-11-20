import type { Dataset } from "./explorer-core";

/**
 * The dataset registry: `defineDataset()` validates a definition once, when its module loads (a mistake fails every start and the unit test, never a user's request),
 * and registers it. Adding a dataset = one `defineDataset({...})` in an `explorer-datasets-*.ts` file imported by `explorer.ts`.
 */
const SETS = new Map<string, Dataset>();
const KEY = /^[a-z][A-Za-z0-9]*$/;
const DS_KEY = /^[a-z][a-z0-9-]*$/;

export function defineDataset(d: Dataset): Dataset {
  if (!DS_KEY.test(d.key)) throw new Error(`dataset key "${d.key}" must be lower-case letters, digits and dashes`);
  // Idempotent on purpose: the dev server re-evaluates modules on hot reload, and a throw here would wedge every API route. Two datasets with one key are caught by the registry unit test.
  const seen = new Set<string>();
  for (const c of d.columns) {
    if (!KEY.test(c.key)) throw new Error(`${d.key}: column key "${c.key}" is not a plain identifier`);
    if (seen.has(c.key)) throw new Error(`${d.key}: duplicate column "${c.key}"`);
    seen.add(c.key);
    for (const f of Object.keys(c.fields ?? {})) if (!KEY.test(f) || f === "id") throw new Error(`${d.key}.${c.key}: hidden field "${f}" is not a plain identifier`);
  }
  const fk = new Set<string>();
  for (const f of d.filters) {
    if (!KEY.test(f.key)) throw new Error(`${d.key}: filter key "${f.key}" is not a plain identifier`);
    if (fk.has(f.key)) throw new Error(`${d.key}: duplicate filter "${f.key}"`);
    fk.add(f.key);
  }
  if (!d.columns.some((c) => c.default)) throw new Error(`${d.key}: no default columns`);
  const sortable = d.columns.find((c) => c.key === d.defaultSort.key);
  if (!sortable || sortable.sort === false || sortable.mask || sortable.money) throw new Error(`${d.key}: default sort "${d.defaultSort.key}" must be a plain sortable column`);
  SETS.set(d.key, d);
  return d;
}
export const getDataset = (key: string): Dataset | undefined => SETS.get(key);
export const allDatasets = (): Dataset[] => [...SETS.values()];
