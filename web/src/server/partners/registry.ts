import type { Adapter } from "./types";
import { logestechs } from "./logestechs";
import { shipox } from "./shipox";
import { fizzpa } from "./fizzpa";
import { omniful } from "./omniful";
import { fastcoo } from "./fastcoo";
import { generic } from "./generic";

/**
 * To add a warehouse system: write an adapter (see types.ts; logestechs.ts = merchant mode, fastcoo.ts = carrier mode as worked
 * examples), register it here, add its `partners.*` strings to an i18n fragment and a guide to integrations-mds/. Nothing else in the
 * platform changes (integrations-mds/ADDING_AN_INTEGRATION.md).
 */
// Built on first use, not at import time: adapters → http → integrations → requests → events → sync → config → registry is an import
// cycle, and an eager array could capture an adapter module that has not finished evaluating.
let adapters: Adapter[] | null = null;
const all = () => (adapters ??= [logestechs, shipox, fizzpa, omniful, fastcoo, generic]);
export const listAdapters = () => all();
export const getAdapter = (key: string): Adapter | undefined => all().find((a) => a.key === key);
