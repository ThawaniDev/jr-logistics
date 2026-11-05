import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    fileParallelism: false, // integration tests share one Postgres database
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { provider: "v8", include: ["src/server/**", "src/lib/**"], reporter: ["text-summary", "html"] },
  },
});
