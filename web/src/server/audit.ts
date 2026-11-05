import { db, type Exec } from "@/db";
import { auditLogs, type User } from "@/db/schema";

export async function audit(
  actor: Pick<User, "id" | "role"> | null,
  action: string, entity: string, entityId?: string | null,
  diff?: unknown, x: Exec = db, meta?: { ip?: string; correlationId?: string },
) {
  await x.insert(auditLogs).values({
    actorId: actor?.id ?? null, actorRole: actor?.role ?? "system", action, entity,
    entityId: entityId ?? null, diff: (diff ?? null) as never, ip: meta?.ip, correlationId: meta?.correlationId,
  });
}
