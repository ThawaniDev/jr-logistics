import { sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { counters } from "@/db/schema";

/** Gap-tolerant, concurrency-safe sequence (atomic upsert). */
export async function nextSeq(x: Exec, key: string): Promise<number> {
  const [r] = await x.insert(counters).values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return r.value;
}
export async function nextRef(x: Exec, prefix: string): Promise<string> {
  const n = await nextSeq(x, prefix);
  return `${prefix}-${String(n).padStart(6, "0")}`;
}
