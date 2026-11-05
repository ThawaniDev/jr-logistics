import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(p) ? [p] : []; });
const files = walk("src").filter((f) => !f.includes("/server/") || f.endsWith("current.ts") === false && /views|catalog/.test(f) === false);
const lit = new Set(), dyn = new Set();
for (const f of walk("src")) {
  if (f.includes("src/server/") || f.includes("src/db/") || f.includes("src/i18n/dictionaries")) continue;
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/\bt\(\s*"([^"]+)"/g)) lit.add(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`([^`]+)`/g)) dyn.add(m[1].replace(/\$\{[^}]*\}/g, "*"));
  for (const m of s.matchAll(/(?:success|label|title|hint):\s*"([a-z_]+\.[a-z_0-9.]+)"/g)) lit.add(m[1]);
  for (const m of s.matchAll(/success="([a-z_]+\.[a-z_0-9.]+)"/g)) lit.add(m[1]);
  for (const m of s.matchAll(/key:\s*"(nav\.[a-z_]+)"/g)) lit.add(m[1]);
  for (const m of s.matchAll(/(?:success:)\s*"([a-z_]+\.[a-z_0-9.]+)"/g)) lit.add(m[1]);
  for (const m of s.matchAll(/(?:success:)\s*[a-z]+\s*\?\s*"([a-z_]+\.[a-z_0-9.]+)"\s*:\s*"([a-z_]+\.[a-z_0-9.]+)"/g)) { lit.add(m[1]); lit.add(m[2]); }
}
console.log(JSON.stringify({ lit: [...lit].sort(), dyn: [...dyn].sort() }, null, 1));
