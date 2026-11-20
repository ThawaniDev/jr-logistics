import { parseKsaDay } from "./calendar";

/** Everything the generator can be told. Same options + same seed (+ same `end` day) → byte-identical data. */
export interface HistoryOptions {
  days: number; companies: number; offices: number; drivers: number; seed: number;
  /** Last Riyadh calendar day of the window, `YYYY-MM-DD`; null = today. */
  end: string | null;
  reset: boolean; dryRun: boolean; yes: boolean;
}

export const DEFAULT_OPTIONS: HistoryOptions = { days: 180, companies: 30, offices: 6, drivers: 70, seed: 42, end: null, reset: false, dryRun: false, yes: false };

export const USAGE = `Usage: npm run db:seed:history -- --yes [options]

  --days N         length of the history window in days            (default 180, 7–730)
  --companies N    business accounts to generate                    (default 30, 1–400)
  --offices N      courier offices to generate                      (default 6, 0–60)
  --drivers N      drivers to generate                              (default 70, 3–1500)
  --seed N         random seed: same flags + seed + --end = same data   (default 42)
  --end YYYY-MM-DD last day of the window (Riyadh time)             (default: today)
  --reset          delete ONLY what this tool generated (original demo data is left alone), then stop
  --dry-run        simulate and print the counts; writes nothing
  --yes            required to write (or reset)

Safety: needs DEMO_MODE=true, refuses NODE_ENV=production, prints the target database first.
Running again without --reset does nothing when history is already present.`;

const intIn = (name: string, raw: string | undefined, lo: number, hi: number): number => {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(n) || n < lo || n > hi) throw new Error(`--${name} must be a whole number between ${lo} and ${hi}${raw !== undefined ? ` (got "${raw}")` : ""}`);
  return n;
};

export function parseHistoryArgs(argv: string[]): HistoryOptions & { help: boolean } {
  const o: HistoryOptions & { help: boolean } = { ...DEFAULT_OPTIONS, help: false };
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const val = () => inline ?? args[++i];
    switch (flag) {
      case "--days": o.days = intIn("days", val(), 7, 730); break;
      case "--companies": o.companies = intIn("companies", val(), 1, 400); break;
      case "--offices": o.offices = intIn("offices", val(), 0, 60); break;
      case "--drivers": o.drivers = intIn("drivers", val(), 3, 1500); break;
      case "--seed": o.seed = intIn("seed", val(), 0, 2 ** 31 - 1); break;
      case "--end": { const v = val(); if (!v || parseKsaDay(v) == null) throw new Error(`--end must be a date like 2026-11-19 (got "${v ?? ""}")`); o.end = v; break; }
      case "--reset": o.reset = true; break;
      case "--dry-run": o.dryRun = true; break;
      case "--yes": case "-y": o.yes = true; break;
      case "--help": case "-h": o.help = true; break;
      default: throw new Error(`Unknown option "${a}". Run with --help.`);
    }
  }
  return o;
}

/** The database a connection string points at, without credentials. */
export function describeDatabase(url: string | undefined): { host: string; name: string; label: string } {
  if (!url) return { host: "?", name: "?", label: "(DATABASE_URL is not set)" };
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.replace(/^\//, "")) || "?";
    return { host: u.host, name, label: `${name} @ ${u.host}` };
  } catch { return { host: "?", name: "?", label: "(unparseable DATABASE_URL)" }; }
}

/**
 * The hard gates, in one place (used by the CLI and by `runHistory`): demo mode on, never production, and an explicit --yes for anything that writes.
 * `ALLOW_DEMO_IN_PRODUCTION` is deliberately NOT honoured here — a production build never receives generated history.
 */
export function assertSafe(o: Pick<HistoryOptions, "dryRun" | "yes" | "reset">, e: Record<string, string | undefined> = process.env): void {
  if (e.NODE_ENV === "production") throw new Error("Refusing to run: NODE_ENV=production. Demo history is for development and demo databases only.");
  if (e.DEMO_MODE !== "true") throw new Error("Refusing to run: DEMO_MODE is not 'true'. Demo history is only generated where demo mode is on.");
  if (!o.dryRun && !o.yes) throw new Error("Refusing to write without --yes (use --dry-run to see the counts first).");
}
