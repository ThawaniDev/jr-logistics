"use client";
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { Avatar, Badge, Section, StatusBadge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import type { RoleMember } from "./admin-roles-lib";

/** Who holds the role. Each name opens that person's page; the footer link opens the Staff list filtered to this role. */
export function MembersCard({ roleKey, members }: { roleKey: string; members: RoleMember[] | undefined }) {
  const { t } = useI18n(); const me = useUser();
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Users className="size-4 text-muted" aria-hidden />{t("rj.members_title")}{members && <span className="ltr-num text-xs font-normal text-muted">({members.length})</span>}</span>} description={t("rj.members_sub")}
      actions={hasPerm(me, "staff.view") || hasPerm(me, "staff.manage") ? <Link data-testid="rj-open-staff" href={`/admin/staff?role=${encodeURIComponent(roleKey)}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">{t("rj.open_staff")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link> : undefined}>
      <div data-testid="rj-members">
        {!members ? <p className="text-sm text-muted">{t("a11y.loading")}</p> : members.length === 0 ? (
          <div className="py-2 text-center"><p className="font-medium">{t("rj.members_none")}</p><p className="text-sm text-muted">{t("rj.members_none_hint")}</p></div>
        ) : (
          <ul className="divide-y divide-line/70">{members.map((m) => (
            <li key={m.id} data-testid={`rj-member-${m.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
              <Avatar name={m.name} size={36} />
              <div className="min-w-0 flex-1"><div><Link href={`/admin/users/${m.id}`} className="font-medium hover:text-accent hover:underline">{m.name}</Link></div><div className="truncate text-xs text-muted"><span className="ltr-num" dir="ltr">{m.email}</span></div></div>
              {m.differs && <span title={t("rj.member_differs_hint")}><Badge tone="warn">{t("rj.member_differs")}</Badge></span>}
              <StatusBadge status={m.status} />
            </li>))}
          </ul>)}
      </div>
    </Section>
  );
}
