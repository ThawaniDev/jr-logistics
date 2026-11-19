import type { Adapter } from "./types";
import { logestechs } from "./logestechs";
import { generic } from "./generic";

/**
 * To add a warehouse system: write an adapter (see types.ts, logestechs.ts as the worked example), register it here, add its
 * `partners.*` strings to src/i18n/fragments/partners.ts. Nothing else in the platform changes.
 */
const ADAPTERS: Adapter[] = [logestechs, generic];
export const listAdapters = () => ADAPTERS;
export const getAdapter = (key: string): Adapter | undefined => ADAPTERS.find((a) => a.key === key);
