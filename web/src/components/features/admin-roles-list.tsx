"use client";
import { KeyRound, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { roleBlurb, roleLabel, type RoleItem } from "./admin-roles-lib";

/** The roles as selectable cards: a column beside the editor on desktop, a scrolling row on phones (the editor stacks below it). `draftName` adds the role being created. */
export function RoleList({ roles, selected, draftName, onSelect }: { roles: RoleItem[]; selected: string; draftName: string | null; onSelect: (key: string) => void }) {
  const { t } = useI18n();
  const card = (key: string, active: boolean, body: React.ReactNode) => (
    <button key={key} type="button" data-testid={`rj-role-${key}`} aria-current={active ? "true" : undefined} onClick={() => onSelect(key)}
      className={cn("min-w-56 shrink-0 rounded-card border p-3 text-start transition focus-visible:outline-2 lg:min-w-0", active ? "border-accent bg-accent/5 shadow-sm" : "border-line bg-card hover:border-accent/50")}>{body}</button>
  );
  return (
    <nav aria-label={t("rj.list_label")} data-testid="rj-list" className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {draftName !== null && card("new", selected === "new", <><div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{draftName || t("rj.new_title")}</span><Badge tone="success">{t("rj.badge_new")}</Badge></div><p className="mt-1 text-xs text-muted">{t("rj.new_note")}</p></>)}
      {roles.map((r) => card(r.key, selected === r.key, <>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{roleLabel(t, r)}</span>
          <span className="flex shrink-0 gap-1">{r.modified && <Badge tone="warn">{t("rj.badge_modified")}</Badge>}<Badge tone={r.isSystem ? "info" : "neutral"}>{t(r.isSystem ? "rj.badge_system" : "rj.badge_custom")}</Badge></span>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><KeyRound className="size-3.5" aria-hidden /><span className="ltr-num tabular-nums">{t(r.permissionCount === 1 ? "rj.perm_1" : "rj.perms_n", { n: r.permissionCount })}</span></span>
          <span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden /><span className="ltr-num tabular-nums">{t(r.memberCount === 1 ? "rj.member_1" : "rj.members_n", { n: r.memberCount })}</span></span>
        </p>
        {roleBlurb(t, r) && <p className="mt-1.5 hidden line-clamp-2 text-xs text-muted lg:block">{roleBlurb(t, r)}</p>}
      </>))}
    </nav>
  );
}
