import { execSync } from "node:child_process";
export default async function globalSetup() {
  const env = { ...process.env, ENV_FILE: ".env.test" };
  execSync("npx tsx scripts/reset-test-db.ts", { stdio: "inherit", env });
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env });
}
