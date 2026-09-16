import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Lock, PlusCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { TXN_LABELS, sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";

export default function BusinessWallet() {
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/wallet").then(({ data }) => setData(data));
  useEffect(() => { load().catch(() => {}); }, []);

  const topup = async (e) => {
    e.preventDefault();
    const val = Number(amount);
    if (!val || val <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    setBusy(true);
    try {
      await api.post("/business/wallet/topup", { amount: val });
      toast.success(`تم شحن محفظتك بمبلغ ${sar(val)} (تجريبي)`);
      setAmount("");
      await load();
      refresh();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;
  const { wallet, transactions } = data;

  return (
    <div className="space-y-6" data-testid="business-wallet-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">المحفظة</h1>
        <p className="text-sm text-slate-400 mt-1">الرصيد، المبالغ المحجوزة كضمان، وسجل الحركات — جميع الأموال تجريبية</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <StatCard testid="wallet-available" icon={Wallet} label="الرصيد المتاح" value={sar(wallet.available)} tone="brand" sub="يمكن استخدامه لتأكيد الطلبات" />
        <StatCard testid="wallet-reserved" icon={Lock} label="محجوز (ضمان طلبات نشطة)" value={sar(wallet.reserved)} tone="gold" sub="يُصرف للعمال بعد تأكيد إتمام العمل" />
      </div>

      <form onSubmit={topup} className="card-surface p-6 space-y-4" data-testid="topup-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-brand" /> شحن المحفظة
          <span className="chip bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">أموال تجريبية</span>
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
          <Input data-testid="topup-amount" type="number" min="1" placeholder="المبلغ بالريال" value={amount}
            onChange={(e) => setAmount(e.target.value)} className="bg-navy-800 border-navy-600 h-11 num max-w-xs" />
          <button data-testid="topup-submit-btn" disabled={busy}
            className="bg-brand text-navy-900 font-bold rounded-xl px-6 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
            {busy ? "جاري الشحن…" : "شحن"}
          </button>
        </div>
      </form>

      <div>
        <h2 className="heading text-lg font-bold mb-4">سجل الحركات</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={Wallet} title="لا توجد حركات" desc="حركات الشحن والحجز والتسوية ستظهر هنا" testid="txns-empty" />
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                    <th className="text-right p-4 font-semibold">النوع</th>
                    <th className="text-right p-4 font-semibold">البيان</th>
                    <th className="text-right p-4 font-semibold">المبلغ</th>
                    <th className="text-right p-4 font-semibold">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`txn-${t._id}`}>
                      <td className="p-4">
                        <span className={`chip ${t.direction === "credit" ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
                          {t.direction === "credit" ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          {TXN_LABELS[t.type] || t.type}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300 text-xs">{t.note}</td>
                      <td className={`p-4 font-bold num ${t.direction === "credit" ? "text-green-300" : "text-rose-400"}`}>
                        {t.direction === "credit" ? "+" : "−"}{sar(t.amount)}
                      </td>
                      <td className="p-4 text-slate-500 text-xs num">{new Date(t.created_at).toLocaleDateString("ar-SA")}</td>
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
