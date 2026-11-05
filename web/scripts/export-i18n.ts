import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import en from "../src/i18n/en";
import ar from "../src/i18n/ar";
import ur from "../src/i18n/ur";

/** Single source of truth: the web dictionaries are exported as assets for the Flutter app. */
const out = path.resolve(__dirname, "../../mobile/assets/i18n");
mkdirSync(out, { recursive: true });
for (const [name, d] of Object.entries({ en, ar, ur })) writeFileSync(path.join(out, `${name}.json`), JSON.stringify(d, null, 0));
console.log(`exported ${Object.keys(en).length} keys → ${out}`);
