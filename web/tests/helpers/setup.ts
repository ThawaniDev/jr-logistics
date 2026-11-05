import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(__dirname, "../../.env.test"), override: true });
(process.env as Record<string, string>).NODE_ENV = "test";
