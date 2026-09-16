import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Banknote, ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { TXN_LABELS, sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";

export default function WorkerWallet() {
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
    if (!val || val <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    if (!form.iban.trim()) return toast.error("أدخل رقم الآيبان");
    setBusy(true);
    try {
      await api.post("/worker/withdrawals", { ...form, amount: val });
      toast.success("تم إرسال طلب السحب — سيراجعه فريق المنصة");
      setForm({ ...form, amount: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;
  const { wallet, transactions } = data;

  return (
    <div className="space-y-6" data-testid="worker-wallet-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">المحفظة والأرباح</h1>
        <p className="text-sm text-slate-400 mt-1">أرباحك من المهام المكتملة وطلبات السحب — أموال تجريبية</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <StatCard testid="wallet-available" icon={Wallet} label="الرصيد المتاح للسحب" value={sar(wallet.available)} tone="brand" sub="يُضاف فور تأكيد المنشأة لإتمام العمل" />
        <StatCard testid="wallet-earned" icon={Banknote} label="إجمالي ما تم صرفه" tone="cyan"
          value={sar(transactions.filter((t) => t.type === "earning").reduce((s, t) => s + t.amount, 0))}
          sub="صافي بعد عمولة المنصة 10%" />
      </div>

      <form onSubmit={submit} className="card-surface p-6 space-y-4" data-testid="withdrawal-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <Landmark className="w-4 h-4 text-brand" /> طلب سحب إلى حسابك البنكي
          <span className="chip bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">تحويل تجريبي</span>
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">المبلغ (ر.س)</label>
            <Input data-testid="withdrawal-amount" type="number" min="1" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">البنك</label>
            <select data-testid="withdrawal-bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {["مصرف الراجحي", "البنك الأهلي السعودي", "بنك الرياض", "البنك السعودي الفرنسي", "STC Pay"].map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">رقم الآيبان</label>
            <Input data-testid="withdrawal-iban" dir="ltr" placeholder="SA.." value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value })} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
        </div>
        <button data-testid="withdrawal-submit-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? "جاري الإرسال…" : "إرسال طلب السحب"}
        </button>
      </form>

      {withdrawals && withdrawals.length > 0 && (
        <div>
          <h2 className="heading text-lg font-bold mb-4">طلبات السحب</h2>
          <div className="space-y-2">
            {withdrawals.map((w) => (
              <div key={w._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`withdrawal-${w._id}`}>
                <p className="font-bold num">{sar(w.amount)}</p>
                <p className="text-xs text-slate-400">{w.bank_name} · <span className="num">{w.iban}</span></p>
                <span className="text-[11px] text-slate-500 num ms-2">{new Date(w.created_at).toLocaleDateString("ar-SA")}</span>
                <span className="ms-auto"><StatusBadge kind="withdrawal" status={w.status} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="heading text-lg font-bold mb-4">سجل الحركات</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={Wallet} title="لا توجد حركات" desc="أرباحك ومدفوعاتك ستظهر هنا" testid="txns-empty" />
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
