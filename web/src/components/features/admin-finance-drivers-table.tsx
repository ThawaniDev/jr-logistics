"use client";
import Link from "next/link";
import { Badge, CellPair, StatusBadge, Td } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasAny, useTx } from "./admin-common";
import { useUser } from "@/components/layout/auth-context";
import { FD_BY_KEY, WALLET_KEYS, type FdCol, type FdRow } from "@/server/finance-drivers-lib";
import { countOf } from "./admin-finance-drivers-lib";
import { Amount } from "./fin-amount";

/** Cells of the Finance › Drivers table. The column catalogue (`FD_COLS`) says what each key is; this file only decides how it looks. */
const TONE_GOLD = new Set(["pendingCents", "cashHeldCents", "walletPendingCents", "payoutFailedCents"]);

export function Money({ c, className }: { c: number | null | undefined; className?: string }) {
  const { locale } = useI18n();
  return <span className={cn("ltr-num tabular-nums", c === 0 && "text-muted", className)}>{fmtMoney(c ?? 0, locale)}</span>;
}

export function DriverCell({ row, col }: { row: FdRow; col: FdCol }) {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser();
  const v = row[col.key];
  switch (col.key) {
    case "name":
      return (
        <div className="min-w-0">
          <CellPair title={<span className="inline-flex items-center gap-2"><Link href={`/admin/finance/drivers/${row.id}`} className="text-accent hover:underline" data-testid={`fd-open-${row.id}`}>{String(v)}</Link>{row.status === "suspended" && <Badge tone="danger">{t("status.suspended")}</Badge>}</span>}
            sub={row.username ? <span className="ltr-num" dir="ltr">{String(row.username)}</span> : undefined} />
        </div>
      );
    case "officeName":
      if (!row.officeId) return <Badge>{t("fdr.independent")}</Badge>;
      return hasAny(me, "offices.view", "offices.manage") ? <Link href={`/admin/offices/${row.officeId}`} className="text-accent hover:underline">{String(v ?? "—")}</Link> : <span>{String(v ?? "—")}</span>;
    case "status": case "verification": return v ? <StatusBadge status={String(v)} /> : <span className="text-muted">—</span>;
    case "city": return <span>{tx(`city.${v}`, v)}</span>;
    case "phone": case "username": return v ? <span className="ltr-num" dir="ltr">{String(v)}</span> : <span className="text-muted">—</span>;
    default: break;
  }
  if (WALLET_KEYS.includes(col.key) && row.paidViaOffice) return <span className="text-xs italic text-muted" data-testid="fd-via-office">{t("fdr.paid_via_office")}</span>;
  if (col.kind === "money") {
    const n = countOf(row, col);
    const amount = Number(v ?? 0);
    return n == null ? <Amount c={amount} className={cn(TONE_GOLD.has(col.key) && amount > 0 && "font-semibold text-gold")} /> : (
      <CellPair className="text-end" title={<Amount c={amount} />} sub={n > 0 ? t("fdr.n_requests", { n }) : undefined} />
    );
  }
  if (col.kind === "int") return <span className={cn("ltr-num tabular-nums", Number(v) === 0 && "text-muted")}>{fmtNum(Number(v ?? 0), locale)}</span>;
  if (col.kind === "date") return <span className="whitespace-nowrap text-muted">{v ? fmtDate(String(v), locale) : "—"}</span>;
  return <span>{v == null || v === "" ? "—" : String(v)}</span>;
}

/** One body row. Numbers are right-aligned (`num`), text left; every cell has its label for the phone cards. */
export function DriverRow({ row, cols, label }: { row: FdRow; cols: FdCol[]; label: (key: string) => string }) {
  return (
    <tr data-testid={`fd-row-${row.id}`} data-driver={row.id}>
      {cols.map((c, i) => {
        const end = c.kind === "money" || c.kind === "int";
        return <Td key={c.key} label={i === 0 ? undefined : label(c.key)} align={end ? "end" : "start"} className={cn("align-middle", c.kind === "money" && "whitespace-nowrap", i === 0 && "max-sm:!text-start")}><DriverCell row={row} col={c} /></Td>;
      })}
    </tr>
  );
}

/** The closing row: sums over every driver of the selection (not only the page). Hidden on phones, where the KPI cards carry the same figures. */
export function TotalsRow({ totals, cols, label, drivers }: { totals: Record<string, number>; cols: FdCol[]; label: string; drivers: number }) {
  const { t, locale } = useI18n();
  return (
    <tr data-testid="fd-totals">
      {cols.map((c, i) => {
        const def = FD_BY_KEY.get(c.key)!;
        const sum = def.kind === "money" ? <Amount c={totals[c.key] ?? 0} className="text-ink" /> : def.kind === "int" ? <span className="ltr-num tabular-nums">{fmtNum(totals[c.key] ?? 0, locale)}</span> : null;
        return <td key={c.key} className={cn("whitespace-nowrap px-4 py-3", def.kind === "money" || def.kind === "int" ? "text-end" : "text-start")}>{i === 0 ? <span>{label}<span className="ms-2 text-xs font-normal text-muted">{t("fdr.totals_of", { n: drivers })}</span></span> : sum}</td>;
      })}
    </tr>
  );
}
