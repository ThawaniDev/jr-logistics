import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Banknote, ArrowDownLeft, ArrowUpRight, Landmark, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function WorkerWallet() {
  const { t, lang } = useI18n();
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [withdrawals, setWithdrawals] = useState(null);
  const [form, setForm] = useState({ amount: "", bank_name: "مصرف الراجحي", iban: "" });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/wallet").then(({ data }) => setData(data)).catch(() => {});
    api.get("/worker/withdrawals").then(({ data }) => setWithdrawals(data.withdrawals)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const val = Number(form.amount);
    if (!val || val <= 0) return toast.error(t("wallet.enterAmount"));
    if (!form.iban.trim()) return toast.error(t("wallet.enterIban"));
    setBusy(true);
    try {
      await api.post("/worker/withdrawals", { ...form, amount: val });
      toast.success(t("wallet.withdrawDone"));
      setForm({ ...form, amount: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const { wallet, transactions } = data;
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  return (
    <div className="space-y-6" data-testid="worker-wallet-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("wallet.titleW")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("wallet.subW")}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard testid="wallet-pending" icon={Clock} label={t("wallet.pending")} value={sar(data.pending_earnings || 0)} tone="gold" sub={t("wallet.pendingNote")} />
        <StatCard testid="wallet-available" icon={Wallet} label={t("wallet.availableW")} value={sar(wallet.available)} tone="brand" sub={t("wallet.availableNoteW")} />
        <StatCard testid="wallet-paid" icon={Banknote} label={t("wallet.paid")} value={sar(data.paid_earnings || 0)} tone="cyan" sub={t("wallet.paidNote")} />
      </div>

      <form onSubmit={submit} className="card-surface p-6 space-y-4" data-testid="withdrawal-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <Landmark className="w-4 h-4 text-brand" /> {t("wallet.withdrawTo")}
          <span className="chip bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">{t("wallet.demoTransfer")}</span>
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("wallet.amountW")}</label>
            <Input data-testid="withdrawal-amount" type="number" min="1" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("wallet.bank")}</label>
            <select data-testid="withdrawal-bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {["مصرف الراجحي", "البنك الأهلي السعودي", "بنك الرياض", "البنك السعودي الفرنسي", "STC Pay"].map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("wallet.iban")}</label>
            <Input data-testid="withdrawal-iban" dir="ltr" placeholder="SA.." value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value })} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
        </div>
        <button data-testid="withdrawal-submit-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? t("wallet.sending") : t("wallet.submitW")}
        </button>
      </form>

      {withdrawals && withdrawals.length > 0 && (
        <div>
          <h2 className="heading text-lg font-bold mb-4">{t("wallet.wHistory")}</h2>
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`withdrawal-${w._id}`}>
                <p className="font-bold num">{sar(w.amount)}</p>
                <p className="text-xs text-slate-400">{w.bank_name} · <span className="num">{w.iban}</span></p>
                <span className="text-[11px] text-slate-500 num ms-2">{new Date(w.created_at).toLocaleDateString(locale)}</span>
                <span className="ms-auto"><StatusBadge kind="withdrawal" status={w.status} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="heading text-lg font-bold mb-4">{t("wallet.txnHistory")}</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={Wallet} title={t("wallet.noTxns")} desc={t("wallet.noTxnsDescW")} testid="txns-empty" />
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                    <th className="text-start p-4 font-semibold">{t("wallet.colType")}</th>
                    <th className="text-start p-4 font-semibold">{t("wallet.colNote")}</th>
                    <th className="text-start p-4 font-semibold">{t("wallet.colAmount")}</th>
                    <th className="text-start p-4 font-semibold">{t("wallet.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tr) => (
                    <tr key={tr._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`txn-${tr._id}`}>
                      <td className="p-4">
                        <span className={`chip ${tr.direction === "credit" ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
                          {tr.direction === "credit" ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          {t(`txn.${tr.type}`)}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300 text-xs">{tr.note}</td>
                      <td className={`p-4 font-bold num ${tr.direction === "credit" ? "text-green-300" : "text-rose-400"}`}>
                        {tr.direction === "credit" ? "+" : "−"}{sar(tr.amount)}
                      </td>
                      <td className="p-4 text-slate-500 text-xs num">{new Date(tr.created_at).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
