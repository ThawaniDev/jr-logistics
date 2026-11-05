import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".next-e2e/**", ".next-live/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", "playwright-report/**", "test-results/**", "coverage/**"]),
  {
    // API responses reach UI components and tests as untyped JSON by design (the Flutter app consumes the same contract);
    // the domain layer in src/server/*.ts stays strictly typed.
    files: ["src/app/**", "src/components/**", "src/server/api/**", "src/lib/api.ts", "tests/**", "e2e/**", "scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
]);

export default eslintConfig;
