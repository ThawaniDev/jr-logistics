import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import en from "../src/i18n/en";
import ar from "../src/i18n/ar";
import ur from "../src/i18n/ur";

/** Single source of truth: the web dictionaries are exported as assets for the Flutter app. */
const out = path.resolve(__dirname, "../../mobile/assets/i18n");
mkdirSync(out, { recursive: true });
/** The app has no plural engine: the English-only singular forms (`<key>__one`, used by the web `translate`) are not exported, so the three files keep identical keys. */
export const forMobile = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.endsWith("__one")));
for (const [name, d] of Object.entries({ en, ar, ur })) writeFileSync(path.join(out, `${name}.json`), JSON.stringify(forMobile(d), null, 0));
console.log(`exported ${Object.keys(forMobile(en)).length} keys → ${out}`);
