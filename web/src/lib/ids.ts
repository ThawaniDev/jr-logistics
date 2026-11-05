import { randomBytes, createHash, randomInt } from "node:crypto";
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const numericCode = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, "0");
