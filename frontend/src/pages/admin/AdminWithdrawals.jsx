import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, CheckCircle2, XCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";

export default function AdminWithdrawals() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [busy, setBusy] = useState("");

  const load = () =>
    api.get("/admin/withdrawals", { params: { status: filter || undefined } })
      .then(({ data }) => setItems(data.withdrawals)).catch(() => {});
  useEffect(() => { load(); }, [filter]);

  const decide = async (id, action) => {
    setBusy(id + action);
    try {
      await api.post(`/admin/withdrawals/${id}/decision`, { action });
      toast.success(action === "approve" ? "تمت الموافقة والتحويل (تجريبي)" : "تم رفض الطلب");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-withdrawals-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">طلبات السحب</h1>
        <p className="text-sm text-slate-400 mt-1">مراجعة والموافقة على تحويلات أرباح العمال — أموال تجريبية</p>
      </div>

      <div className="flex gap-2" data-testid="withdrawal-filters">
        {[["pending", "قيد المراجعة"], ["approved", "تم التحويل"], ["rejected", "مرفوض"], ["", "الكل"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} data-testid={`wfilter-${k || "all"}`}
            className={`chip ${filter === k ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {!items ? (
        <p className="text-slate-500 text-sm">جاري التحميل…</p>
      ) : items.length === 0 ? (
        <EmptyState icon={Banknote} title="لا توجد طلبات" desc="طلبات سحب العمال ستظهر هنا" testid="withdrawals-empty" />
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <div key={w._id} className="card-surface p-5 flex flex-wrap items-center gap-4" data-testid={`admin-withdrawal-${w._id}`}>
              <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-[220px]">
                <p className="font-semibold text-sm">{w.worker?.name} <span className="text-slate-500 text-xs num">{w.worker?.phone}</span></p>
                <p className="text-xs text-slate-400 mt-1">{w.bank_name} · <span className="num">{w.iban}</span></p>
                <p className="text-[11px] text-slate-500 mt-1">
                  رصيده المتاح: <span className="num text-brand">{sar(w.wallet?.available)}</span> · <span className="num">{new Date(w.created_at).toLocaleDateString("ar-SA")}</span>
                </p>
              </div>
              <p className="heading text-xl font-black text-slate-100 num">{sar(w.amount)}</p>
              <StatusBadge kind="withdrawal" status={w.status} />
              {w.status === "pending" && (
                <div className="flex gap-2">
                  <button data-testid={`approve-${w._id}`} disabled={busy}
                    onClick={() => decide(w._id, "approve")}
                    className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-emerald-500/25 disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" /> موافقة وتحويل
                  </button>
                  <button data-testid={`reject-${w._id}`} disabled={busy}
                    onClick={() => decide(w._id, "reject")}
                    className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-rose-500/20 disabled:opacity-50 transition-colors">
                    <XCircle className="w-3.5 h-3.5" /> رفض
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
