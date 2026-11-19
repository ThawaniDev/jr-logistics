"use client";
import { useState } from "react";
import { Badge, Button, Input, Modal, Notice, Select, useAction, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { qs, useDebounced } from "./admin-common";

// ───────────────────────── Wallet adjustment ─────────────────────────
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`);
/** Wallet adjustment dialog. `account` pre-selects who is adjusted (e.g. from a company page); without it the staff member searches for the account. */
export interface AdjustAccount { id: string; name: string; role: string }
interface AdjustProps { open: boolean; onClose: () => void; onDone: () => void; account?: AdjustAccount }
export function AdjustModal(props: AdjustProps) { return props.open ? <AdjustInner {...props} /> : null; }
function AdjustInner({ open, onClose, onDone, account }: AdjustProps) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const canSearch = hasPerm(me, "users.view");
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim(), 300);
  const [sel, setSel] = useState<AdjustAccount | null>(account ?? null); const [uuid, setUuid] = useState("");
  const [dir, setDir] = useState<"credit" | "debit">("credit"); const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [key] = useState(newKey); const [err, setErr] = useState<string | null>(null);
  const found = useApi(open && canSearch && dq.length >= 2 ? `/admin/users${qs({ q: dq, pageSize: 8 })}` : null);
  const userId = sel?.id ?? (canSearch ? "" : uuid.trim());
  const cents = sarToCents(amount || 0);
  const valid = !!userId && cents > 0 && reason.trim().length >= 5;
  const submit = () => a.run("adj", () => post("/admin/finance/adjustments", { userId, amountCents: dir === "credit" ? cents : -cents, reason: reason.trim(), idempotencyKey: key }),
    { success: "common.saved", onDone: () => { onDone(); onClose(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <Modal open={open} onClose={onClose} title={t("adm.adjust_title")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="fin-adjust-submit" loading={a.is("adj")} disabled={!valid} onClick={submit}>{t("common.confirm")}</Button></>}>
      <Notice tone="warn">{t("adm.adjust_note")}</Notice>
      {canSearch || account ? (
        <div className="space-y-2">
          {sel ? (
            <div className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-sm"><span>{sel.name} <Badge className="ms-1">{t(`role.${sel.role}`)}</Badge></span>{!account && <Button size="sm" variant="ghost" onClick={() => setSel(null)}>{t("common.edit")}</Button>}</div>
          ) : <>
            <Input label={t("adm.find_account")} placeholder={t("admin.search_users")} value={q} onChange={(e) => setQ(e.target.value)} />
            {dq.length >= 2 && (found.data ? (
              found.data.items.filter((u: any) => ["business", "driver", "office"].includes(u.role)).length === 0 ? <p className="text-sm text-muted">{t("common.no_results")}</p> : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">{found.data.items.filter((u: any) => ["business", "driver", "office"].includes(u.role)).map((u: any) => (
                  <li key={u.id}><button type="button" className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-start text-sm hover:border-accent/60" onClick={() => setSel({ id: u.id, name: u.name, role: u.role })}><span>{u.name}</span><span className="text-xs text-muted">{t(`role.${u.role}`)}</span></button></li>))}</ul>)
            ) : <p className="text-sm text-muted">…</p>)}
          </>}
        </div>
      ) : <Input label={t("adm.user_id")} ltr value={uuid} onChange={(e) => setUuid(e.target.value)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t("adm.direction")} options={[{ value: "credit", label: t("adm.credit") }, { value: "debit", label: t("adm.debit") }]} value={dir} onChange={(e) => setDir(e.target.value as "credit" | "debit")} />
        <Input data-testid="fin-adjust-amount" label={t("wallet.amount_sar")} type="number" min="0" step="0.01" ltr value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Input data-testid="fin-adjust-reason" label={t("req.reason")} hint={t("adm.reason_min5")} value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}
