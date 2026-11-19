import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { startGoogleStub } from "./google-stub";
export default async function globalSetup() {
  rmSync("e2e/.auth", { recursive: true, force: true }); // saved sessions belong to the database that is about to be reset
  const env = { ...process.env, ENV_FILE: ".env.test" };
  execSync("npx tsx scripts/reset-test-db.ts", { stdio: "inherit", env });
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env });
  return startGoogleStub(); // Google Routes / Geocoding stand-in for the whole run; returned function = teardown
}
