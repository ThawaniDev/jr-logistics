"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, Minus } from "lucide-react";
import { Badge, Button, EmptyState, SearchBox, Table, Td, Toolbar } from "@/components/ui";
import { PERM_GROUPS, SENSITIVE_PERMS } from "@/server/roles-catalog";
import { useI18n } from "@/i18n/provider";
import { csvOfMatrix, roleLabel, searchPerms, type RoleItem } from "./admin-roles-lib";

/** Read-only roles × permissions matrix (`/admin/roles?view=matrix`): one column per role, one row per permission grouped by area, with CSV export. */
export function RolesMatrix({ roles }: { roles: RoleItem[] }) {
  const { t } = useI18n(); const [q, setQ] = useState(""); const [sens, setSens] = useState(false);
  const label = (p: string) => t(`rjp.${p}`);
  const all = useMemo(() => PERM_GROUPS.flatMap((g) => [...g.perms]), []);
  const visible = useMemo(() => new Set(searchPerms(all, q, label, (p) => t(`rjp.${p}.d`)).filter((p) => !sens || SENSITIVE_PERMS.has(p))), [all, q, sens, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = roles.map((r) => roleLabel(t, r));
  const exportCsv = () => {
    const csv = csvOfMatrix(roles.map((r, i) => ({ permissions: r.permissions, label: names[i] })), (g) => t(`rj.group_${g}`), label, [t("rj.col_group"), t("rj.col_permission"), t("rj.col_key")]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${t("rj.csv_name")}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const head = [{ label: t("rj.col_permission"), className: "sticky start-0 z-10 min-w-56 bg-bg2" }, ...roles.map((r, i) => ({ label: names[i], align: "center" as const, className: "min-w-24 whitespace-nowrap"}))];
  return (
    <div className="space-y-4" data-testid="rj-matrix">
      <Toolbar end={<Button variant="secondary" data-testid="rj-export" onClick={exportCsv}><Download className="size-4" aria-hidden />{t("rj.export_csv")}</Button>}>
        <SearchBox value={q} onChange={setQ} placeholder={t("rj.search")} label={t("rj.search")} testId="rj-matrix-search" />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" data-testid="rj-matrix-sensitive" className="size-4 accent-[var(--jr-accent)]" checked={sens} onChange={(e) => setSens(e.target.checked)} />{t("rj.sensitive_only")}</label>
      </Toolbar>
      {visible.size === 0 ? <EmptyState title={t("rj.none_match")} hint={t("rj.none_match_hint")} /> : (
        <Table label={t("rj.matrix_title")} dense head={head}>
          {PERM_GROUPS.filter((g) => g.perms.some((p) => visible.has(p))).map((g) => (
            <Fragment key={g.id}>
              <tr className="bg-bg2/40"><th scope="colgroup" colSpan={roles.length + 1} className="sticky start-0 px-4 py-1.5 text-start text-xs font-semibold text-muted">{t(`rj.group_${g.id}`)}</th></tr>
              {g.perms.filter((p) => visible.has(p)).map((p) => (
                <tr key={p} data-testid={`rj-matrix-row-${p}`}>
                  <th scope="row" className="sticky start-0 z-10 bg-card px-4 py-2 text-start font-normal">
                    <span className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{label(p)}</span>{SENSITIVE_PERMS.has(p) && <span title={t("rj.sensitive_hint")}><Badge tone="warn"><AlertTriangle className="size-3" aria-hidden />{t("rj.sensitive")}</Badge></span>}</span>
                    <span className="ltr-num block text-[11px] text-muted" dir="ltr">{p}</span>
                  </th>
                  {roles.map((r, i) => { const has = r.permissions.includes(p); return (
                    <Td key={r.key} align="center"><span data-testid={`rj-cell-${r.key}-${p}`} data-has={has ? "1" : "0"} className="relative inline-flex" title={`${names[i]}: ${t(has ? "rj.has" : "rj.has_not")}`}>
                      {has ? <Check className="size-4 text-accent" aria-hidden /> : <Minus className="size-4 text-muted/50" aria-hidden />}<span className="sr-only">{t(has ? "rj.has" : "rj.has_not")}</span></span></Td>); })}
                </tr>))}
            </Fragment>))}
          <tr className="border-t-2 border-line bg-bg2/40"><th scope="row" className="sticky start-0 bg-bg2 px-4 py-2 text-start text-xs font-semibold text-muted">{t("rj.perms_row")}</th>{roles.map((r) => <Td key={r.key} align="center" num>{r.permissionCount}</Td>)}</tr>
          <tr className="bg-bg2/40"><th scope="row" className="sticky start-0 bg-bg2 px-4 py-2 text-start text-xs font-semibold text-muted">{t("rj.members_row")}</th>{roles.map((r) => <Td key={r.key} align="center" num><Link href={`/admin/staff?role=${encodeURIComponent(r.key)}`} className="text-accent hover:underline">{r.memberCount}</Link></Td>)}</tr>
        </Table>)}
    </div>
  );
}
