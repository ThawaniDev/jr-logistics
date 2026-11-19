"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { UserCheck } from "lucide-react";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { ENTITY_PERMS, entityHref } from "./admin-system-lib";

/** Role of a person as a small coloured badge (business / driver / courier office / staff). */
export function RoleBadge({ role }: { role?: string | null }) {
  const tx = useTx();
  if (!role) return null;
  return <Badge tone={role === "business" ? "info" : role === "driver" ? "success" : role === "office" ? "warn" : "neutral"}>{tx(`role.${role}`, role)}</Badge>;
}

export function UrgentBadge() {
  const { t } = useI18n();
  return <Badge tone="danger">{t("support.urgent")}</Badge>;
}

/** The person's name, linked to their account page when the signed-in staff may open it (companies, offices, drivers). */
export function EntityLink({ role, id, children, testid }: { role?: string | null; id?: string | null; children: ReactNode; testid?: string }) {
  const me = useUser();
  const href = entityHref(role, id);
  if (!href || !hasAny(me, ...(ENTITY_PERMS[role ?? ""] ?? []))) return <>{children}</>;
  return <Link href={href} data-testid={testid} className="text-accent hover:underline">{children}</Link>;
}

/** Who handles a case: "You", the person's name, a neutral "Assigned" when the name is not known, or a muted "Unassigned". */
export function HandlerCell({ id, name }: { id?: string | null; name?: string | null }) {
  const { t } = useI18n(); const me = useUser();
  if (!id) return <span className="text-muted">{t("adm.unassigned")}</span>;
  return <span className="inline-flex max-w-full items-center gap-1.5"><UserCheck className="size-3.5 shrink-0 text-muted" aria-hidden /><span className="truncate">{id === me.id ? t("foa.case_assigned_you") : name ?? t("foa.case_assigned_other")}</span></span>;
}

/** `STATUS → STATUS` notes of a complaint, with the statuses translated; anything else is returned as written. */
export function statusNote(body: string, t: (k: string) => string): string {
  const m = /^(\w+) → (\w+)$/.exec(body);
  if (!m) return body;
  const name = (s: string) => { const k = t(`status.${s}`); return k.startsWith("status.") ? s : k; };
  return `${name(m[1])} → ${name(m[2])}`;
}
