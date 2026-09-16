import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Lock, PlusCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function BusinessWallet() {
  const { t, lang } = useI18n();
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/wallet").then(({ data }) => setData(data));
  useEffect(() => { load().catch(() => {}); }, []);

  const topup = async (e) => {
    e.preventDefault();
    const val = Number(amount);
    if (!val || val <= 0) return toast.error(t("wallet.enterAmount"));
    setBusy(true);
    try {
      await api.post("/business/wallet/topup", { amount: val });
      toast.success(t("wallet.topupDone"));
      setAmount("");
      await load();
      refresh();
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
    <div className="space-y-6" data-testid="business-wallet-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("wallet.titleB")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("wallet.subB")}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <StatCard testid="wallet-available" icon={Wallet} label={t("wallet.available")} value={sar(wallet.available)} tone="brand" sub={t("wallet.availableNoteB")} />
        <StatCard testid="wallet-reserved" icon={Lock} label={t("wallet.reserved")} value={sar(wallet.reserved)} tone="gold" sub={t("wallet.reservedNote")} />
      </div>

      <form onSubmit={topup} className="card-surface p-6 space-y-4" data-testid="topup-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-brand" /> {t("wallet.topup")}
          <span className="chip bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">{t("wallet.demoMoney")}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          {[1000, 5000, 10000].map((v) => (
            <button key={v} type="button" onClick={() => setAmount(String(v))} data-testid={`topup-quick-${v}`}
              className="chip bg-navy-800 text-slate-300 border-navy-600 hover:border-brand/40 hover:text-brand num">
              {sar(v)}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Input data-testid="topup-amount" type="number" min="1" placeholder={t("wallet.amountPh")} value={amount}
            onChange={(e) => setAmount(e.target.value)} className="bg-navy-800 border-navy-600 h-11 num max-w-xs" />
          <button data-testid="topup-submit-btn" disabled={busy}
            className="bg-brand text-navy-900 font-bold rounded-xl px-6 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
            {busy ? t("wallet.charging") : t("wallet.charge")}
          </button>
        </div>
      </form>

      <div>
        <h2 className="heading text-lg font-bold mb-4">{t("wallet.txnHistory")}</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={Wallet} title={t("wallet.noTxns")} desc={t("wallet.noTxnsDescB")} testid="txns-empty" />
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
