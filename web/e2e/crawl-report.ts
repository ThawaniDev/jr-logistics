/**
 * Summarises `.crawl/<theme>/*.json` (written by crawl.spec.ts), grouped by category:
 *   npx tsx e2e/crawl-report.ts [theme] [--cat=overflow] [--run=admin-ar] [--max=6] [--unvisited]
 * One line per distinct finding (ids and numbers normalised) with the number of pages and runs it appears on and a few example URLs.
 */
import { readdirSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const theme = args.find((a) => !a.startsWith("--")) ?? "default";
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const only = opt("cat"), runFilter = opt("run"), max = Number(opt("max") ?? 5);
const dir = `.crawl/${theme}`;
type Issue = { cat: string; sev: string; msg: string };
type Pg = { url: string; finalUrl: string; status: number; ms: number; issues: Issue[] };
const norm = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\d{2,}/g, "N").replace(/\s+/g, " ");
const groups = new Map<string, { sev: string; cat: string; msg: string; pages: Set<string>; runs: Set<string>; n: number }>();
let total = 0; const unvisited: Record<string, string[]> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && !x.startsWith("probe") && !x.startsWith("dialogs")).sort()) {
  if (runFilter && !f.startsWith(runFilter)) continue;
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  if (!j.pages) continue;
  const run = f.replace(".json", ""); total += j.pages.length; if (j.unvisited?.length) unvisited[run] = j.unvisited;
  for (const p of j.pages as Pg[]) for (const i of p.issues) {
    if (only && i.cat !== only) continue;
    const msg = i.cat === "overflow" ? norm(i.msg).slice(0, 160) : norm(i.msg).slice(0, 200);
    const key = `${i.sev}|${i.cat}|${msg}`;
    const g = groups.get(key) ?? { sev: i.sev, cat: i.cat, msg, pages: new Set(), runs: new Set(), n: 0 };
    g.n++; g.pages.add(norm(p.url.split("?")[0])); g.runs.add(run); groups.set(key, g);
  }
}
console.log(`pages visited (all runs in ${dir}): ${total}`);
const order: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
for (const g of [...groups.values()].sort((a, b) => order[a.sev] - order[b.sev] || a.cat.localeCompare(b.cat) || b.pages.size - a.pages.size)) {
  console.log(`${g.sev.padEnd(6)} ${g.cat.padEnd(15)} pages=${String(g.pages.size).padStart(3)} runs=${g.runs.size}  ${g.msg}`);
  console.log(`         e.g. ${[...g.pages].slice(0, max).join(", ")}   [${[...g.runs].slice(0, 4).join(", ")}]`);
}
if (args.includes("--unvisited")) for (const [r, u] of Object.entries(unvisited)) console.log(`UNVISITED ${r}: ${u.join(" ")}`);
