/**
 * Start-up configuration check for a production build (called once from `instrumentation.ts`).
 *
 * The rest of the code already refuses to *use* a missing secret (`DEPENDENCY_UNAVAILABLE`), but only when the first person reaches that
 * feature: a deployment without `AUTH_SECRET` boots, answers `/health` with 200 and then fails every delivery code and every two-step
 * sign-in. A wrong deployment must be loud at boot instead. `errors` stop the process; `warnings` are logged once.
 *
 * Demo / test deployments (`DEMO_MODE=true` + the long acknowledgement) keep working with short secrets: the Playwright run and the
 * demo servers use made-up values on purpose. They only get warnings, except for the two things nothing can run without.
 */
export interface EnvReport { errors: string[]; warnings: string[] }
type Env = Record<string, string | undefined>;

const DEMO_ACK = "yes-this-is-a-demo-deployment";
/** Values that ship in `.env.example` or are guessed first by anybody. */
const PLACEHOLDER = /(change[-_ ]?me)|^(secret|password|test|example|default|todo|(your|replace)[-_ ].*|(.)\4+|1234\d*)$/i;
const MIN_SECRET = 16;
const weak = (v: string) => v.length < MIN_SECRET || PLACEHOLDER.test(v.trim());

export function checkEnv(e: Env): EnvReport {
  const errors: string[] = [], warnings: string[] = [];
  const demoAck = e.DEMO_MODE === "true" && e.ALLOW_DEMO_IN_PRODUCTION === DEMO_ACK;
  /** A problem that is an error on a real deployment and only a warning on a demo / test one. */
  const strict = (msg: string) => (demoAck ? warnings : errors).push(msg);

  if (!e.DATABASE_URL) errors.push("DATABASE_URL is not set: nothing can be read or written.");

  const auth = e.AUTH_SECRET ?? "";
  if (auth.length < MIN_SECRET) errors.push(`AUTH_SECRET is ${auth ? "shorter than 16 characters" : "not set"}: delivery codes and two-step sign-in cannot be signed (set 32+ random characters).`);
  else if (PLACEHOLDER.test(auth.trim())) strict("AUTH_SECRET is a placeholder value: anybody can forge delivery codes with it.");
  else if (auth.length < 32) warnings.push("AUTH_SECRET is shorter than 32 characters.");

  const cron = e.CRON_SECRET ?? "";
  if (cron) { if (weak(cron)) strict("CRON_SECRET is a placeholder or shorter than 16 characters: anybody could run the housekeeping tick and read the operator health view."); }
  else warnings.push(e.INTERNAL_SCHEDULER === "true"
    ? "CRON_SECRET is not set: the deep /health view and POST /api/v1/cron/tick are unavailable (the internal scheduler still runs)."
    : "CRON_SECRET is not set and INTERNAL_SCHEDULER is not true: nothing runs the housekeeping (webhook retries, expiry, payouts).");

  const driver = e.STORAGE_DRIVER ?? "";
  if (driver && driver !== "s3" && driver !== "local") errors.push(`STORAGE_DRIVER="${driver}" is not supported (use "s3" or "local").`);
  else if (driver === "s3") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !e[k]);
    if (missing.length) errors.push(`STORAGE_DRIVER=s3 but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set: every document upload would fail.`);
  } else if (driver === "local") { if (!e.UPLOAD_DIR) warnings.push("STORAGE_DRIVER=local without UPLOAD_DIR: documents go to ./uploads inside the app folder (lost on every container rebuild)."); }
  else warnings.push("STORAGE_DRIVER is not set: document uploads are refused (503) until a durable storage is configured.");

  if (!e.INTEGRATIONS_SECRET) warnings.push("INTEGRATIONS_SECRET is not set: warehouse-system connections cannot be saved.");
  else if (e.INTEGRATIONS_SECRET.length < MIN_SECRET) warnings.push("INTEGRATIONS_SECRET is shorter than 16 characters.");

  if (e.DEMO_MODE === "true") warnings.push(demoAck
    ? "DEMO MODE IS ACTIVE: demo accounts and the super admin credentials are published on the sign-in page. Never use it for real customers."
    : "DEMO_MODE=true is ignored in production (the acknowledgement variable is not set): demo mode stays OFF.");
  if (e.ALLOW_PRIVATE_OUTBOUND) warnings.push("ALLOW_PRIVATE_OUTBOUND is set: outbound calls may reach private addresses and http:// (tests only).");

  if (!e.APP_URL || /localhost|127\.0\.0\.1/.test(e.APP_URL)) warnings.push(`APP_URL is ${e.APP_URL ? e.APP_URL : "not set"}: tracking links in SMS and notifications will point there.`);
  const proxy = (e.TRUSTED_PROXY ?? "1").trim().toLowerCase();
  if (!(proxy === "none" || proxy === "cloudflare" || /^\d+$/.test(proxy))) warnings.push(`TRUSTED_PROXY="${e.TRUSTED_PROXY}" is not understood (use a number, "cloudflare" or "none"): every caller shares one rate-limit bucket.`);
  if (e.DB_POOL_MAX && !(Number(e.DB_POOL_MAX) >= 1)) warnings.push("DB_POOL_MAX is not a positive number: the default of 10 is used.");
  return { errors, warnings };
}

/**
 * The password the first super admin is created with (`SUPER_ADMIN_PASSWORD`). It is temporary — the account must change it at the first sign-in — but it
 * sits in a deployment file until then, so a guessable one is refused when the admin is created on a real (non-demo) deployment.
 */
export function initialAdminPasswordProblem(pw: string | undefined): string | null {
  const p = pw ?? "";
  if (p.length < 12) return "use at least 12 characters";
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "use letters and digits";
  if (PLACEHOLDER.test(p.trim()) || /password|admin|changeme|jrlogistics|123456/i.test(p)) return "it contains a guessable word or sequence (password, admin, changeme, 123456 …)";
  return null;
}

/** Logs the report as JSON lines and throws on errors, so the process does not start with a broken configuration. */
export function assertProductionEnv(e: Env = process.env, log: (line: string) => void = (l) => console.error(l)) {
  const { errors, warnings } = checkEnv(e);
  const ts = new Date().toISOString();
  for (const msg of warnings) log(JSON.stringify({ level: "warn", ts, msg: `config: ${msg}` }));
  for (const msg of errors) log(JSON.stringify({ level: "fatal", ts, msg: `config: ${msg}` }));
  if (errors.length) throw new Error(`Refusing to start: ${errors.length} configuration error(s). ${errors.join(" ")}`);
}

/**
 * For `instrumentation.ts`: check, and on errors make the process EXIT with code 1. A bare throw is not enough: Next.js keeps listening and answers
 * every request with a 500, so the container looks "running" to an orchestrator that restarts on exit and to anyone reading `docker ps`.
 * (The short delay lets the log lines above reach stderr first.)
 */
export function enforceProductionEnv(e: Env = process.env) {
  try { assertProductionEnv(e); }
  catch (e) { process.exitCode = 1; setTimeout(() => process.exit(1), 100); throw e; }
}
