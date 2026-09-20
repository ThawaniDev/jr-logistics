import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, CheckCircle2, XCircle, Eye, FileText, Landmark, Wallet } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const STATUS_CLS = {
  pending_review: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  under_review: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  paid: "bg-green-500/10 text-green-300 border-green-500/30",
  rejected: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  adjustment: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

export default function AdminFinance() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const perms = user?.role === "admin" ? ["*"] : (user?.staff_profile?.permissions || []);
  const can = (p) => perms.includes("*") || perms.includes(p);
  const [tab, setTab] = useState("settlements");
  const [settlements, setSettlements] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [filter, setFilter] = useState("");
  const [batches, setBatches] = useState(null);
  const [busy, setBusy] = useState("");
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () => {
    api.get("/admin/finance/settlements", { params: { status: filter || undefined } })
      .then(({ data }) => setSettlements(data.settlements)).catch((e) => toast.error(errMsg(e)));
    api.get("/admin/finance/platform").then(({ data }) => setPlatform(data)).catch(() => {});
    api.get("/admin/finance/ledger").then(({ data }) => setLedger(data.ledger)).catch(() => {});
    api.get("/admin/finance/invoices").then(({ data }) => setInvoices(data.invoices)).catch(() => {});
    api.get("/admin/finance/payouts/batches").then(({ data }) => setBatches(data.batches)).catch(() => {});
  };
  useEffect(() => { load(); }, [filter]);

  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      const res = await fn();
      toast.success(msg);
      load();
      return res;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-finance-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("fin.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("fin.sub")}</p>
      </div>

      {platform && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard testid="fin-commission" icon={Banknote} label={t("fin.commissionRev")} value={sar(platform.commission_revenue)} tone="brand" />
          <StatCard testid="fin-owed" icon={Wallet} label={t("fin.driverOwed")} value={sar(platform.driver_amounts_owed)} tone="gold" />
          <StatCard testid="fin-paid" icon={CheckCircle2} label={t("fin.driverPaid")} value={sar(platform.driver_payouts_paid)} tone="cyan" />
          <StatCard testid="fin-reserved" icon={Landmark} label={t("fin.reserved")} value={sar(platform.reserved_total)} tone="blue" />
        </div>
      )}

      {platform && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="fin-separation-cards">
          <StatCard testid="fin-customer-payments" icon={Wallet} label={t("finx.customerPayments")} value={sar(platform.customer_payments)} tone="blue" />
          <StatCard testid="fin-platform-fees" icon={Banknote} label={t("finx.platformFees")} value={sar(platform.platform_fees)} tone="brand" />
          <StatCard testid="fin-office-earnings" icon={Landmark} label={t("finx.officeEarnings")} value={sar(platform.office_earnings_paid)} tone="cyan" />
          <StatCard testid="fin-driver-earnings" icon={Wallet} label={t("finx.driverEarnings")} value={sar(platform.driver_earnings_paid)} tone="gold" />
        </div>
      )}

      {platform && (
        <div className="card-surface p-4 flex flex-wrap items-center gap-3" data-testid="batch-bar">
          <span className="text-xs text-slate-400">{t("finx.settlementPeriod")}: <b>{t(`finx.period_${platform.settlement_period || "weekly"}`)}</b> · <span className="num">{platform.settlement_period_key}</span></span>
          <span className="text-xs text-amber-400">{t("finx.pendingApproved")}: <b className="num">{platform.pending_batches}</b></span>
          {can("payout_execute") && (
            <button data-testid="run-batch-btn" disabled={busy === "batch" || !platform.pending_batches}
              onClick={() => act("batch", () => api.post("/admin/finance/payouts/run-batch", { method: "bank_transfer" }), t("finx.batchDone"))}
              className="ms-auto flex items-center gap-1.5 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover disabled:opacity-50 transition-colors">
              <Banknote className="w-3.5 h-3.5" /> {t("finx.runBatch")}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap" data-testid="finance-tabs">
        {[["settlements", t("fin.tabSettlements")], ["ledger", t("fin.tabLedger")], ["invoices", t("fin.tabInvoices")], ["batches", t("finx.tabBatches")]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`fin-tab-${k}`}
            className={`chip ${tab === k ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "settlements" && (
        <>
          <div className="flex gap-2 flex-wrap" data-testid="settlement-filters">
            {["", "pending_review", "under_review", "approved", "paid", "rejected"].map((s) => (
              <button key={s} onClick={() => setFilter(s)} data-testid={`sfilter-${s || "all"}`}
                className={`chip ${filter === s ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
                {s ? t(`fin.st_${s}`) : t("common.all")}
              </button>
            ))}
          </div>
          {!settlements ? (
            <p className="text-slate-500 text-sm">{t("common.loading")}</p>
          ) : settlements.length === 0 ? (
            <EmptyState icon={Banknote} title={t("fin.empty")} desc={t("fin.emptyDesc")} testid="settlements-empty" />
          ) : (
            <div className="space-y-3">
              {settlements.map((s) => (
                <div key={s._id} className="card-surface p-5 space-y-3" data-testid={`settlement-${s._id}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <p className="font-semibold text-sm">{s.request?.title}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {s.business?.business_profile?.company_name || s.business?.name} ← {s.driver?.name}
                        · <span className="num">{s.request?.start_date}</span>
                      </p>
                    </div>
                    <span className={`chip ${STATUS_CLS[s.status] || ""}`}>{t(`fin.st_${s.status}`)}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
                      <p className="text-slate-500">{t("fin.qty")}</p>
                      <p className="font-semibold mt-1 num">{s.final_qty} <span className="text-slate-500">/ {s.expected_qty}</span></p>
                    </div>
                    <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
                      <p className="text-slate-500">{t("fin.gross")}</p>
                      <p className="font-semibold mt-1 num">{sar(s.gross)}</p>
                    </div>
                    <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
                      <p className="text-slate-500">{t("fin.commission")}</p>
                      <p className="font-semibold mt-1 num text-amber-400">{sar(s.commission)}</p>
                    </div>
                    <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
                      <p className="text-slate-500">{t("fin.vat")}</p>
                      <p className="font-semibold mt-1 num">{sar(s.vat)}</p>
                    </div>
                    <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
                      <p className="text-slate-500">{t("fin.net")}</p>
                      <p className="font-semibold mt-1 num text-brand">{sar(s.net)}</p>
                    </div>
                  </div>
                  {s.approved && (
                    <p className="text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2" data-testid={`settlement-approver-${s._id}`}>
                      {t("fin.approvedBy")}: <b>{s.approved.accountant_name}</b> — <span className="num">{new Date(s.approved.at).toLocaleString(locale)}</span>
                    </p>
                  )}
                  {s.payout && (
                    <p className="text-[11px] text-green-300 bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2" data-testid={`settlement-payer-${s._id}`}>
                      {t("fin.paidBy")}: <b>{s.payout.executed_by.name}</b> — {s.payout.method} · <span className="num">{s.payout.reference}</span> · {t("fin.invoice")} <span className="num">{s.invoice_no}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {s.status === "pending_review" && can("settlement_review") && (
                      <button data-testid={`sreview-${s._id}`} disabled={busy}
                        onClick={() => act(`r${s._id}`, () => api.post(`/admin/finance/settlements/${s._id}/review`, {}), t("fin.reviewed"))}
                        className="flex items-center gap-1.5 bg-blue-500/15 border border-blue-500/40 text-blue-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-blue-500/25 disabled:opacity-50 transition-colors">
                        <Eye className="w-3.5 h-3.5" /> {t("fin.review")}
                      </button>
                    )}
                    {["pending_review", "under_review"].includes(s.status) && can("settlement_approve") && (
                      <button data-testid={`sapprove-${s._id}`} disabled={busy}
                        onClick={() => act(`a${s._id}`, () => api.post(`/admin/finance/settlements/${s._id}/approve`, {}), t("fin.approvedToast"))}
                        className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-emerald-500/25 disabled:opacity-50 transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("fin.approve")}
                      </button>
                    )}
                    {s.status === "approved" && can("payout_execute") && (
                      <button data-testid={`spayout-${s._id}`} disabled={busy}
                        onClick={() => act(`p${s._id}`, () => api.post(`/admin/finance/settlements/${s._id}/payout`, { method: "bank_transfer" }), t("fin.paidToast"))}
                        className="flex items-center gap-1.5 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover disabled:opacity-50 transition-colors">
                        <Banknote className="w-3.5 h-3.5" /> {t("fin.payout")}
                      </button>
                    )}
                    {["pending_review", "under_review"].includes(s.status) && can("settlement_review") && (
                      <button data-testid={`sreject-${s._id}`} disabled={busy}
                        onClick={() => {
                          const note = window.prompt(t("fin.rejectReason"));
                          if (note) act(`x${s._id}`, () => api.post(`/admin/finance/settlements/${s._id}/reject`, { note }), t("fin.rejectedToast"));
                        }}
                        className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-rose-500/20 disabled:opacity-50 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> {t("fin.reject")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "ledger" && (
        !ledger ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                    <th className="text-start p-3 font-semibold">{t("fin.lType")}</th>
                    <th className="text-start p-3 font-semibold">{t("fin.lAmount")}</th>
                    <th className="text-start p-3 font-semibold">{t("fin.lActor")}</th>
                    <th className="text-start p-3 font-semibold">{t("fin.lNote")}</th>
                    <th className="text-start p-3 font-semibold">{t("fin.lDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.slice(0, 100).map((l) => (
                    <tr key={l._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`ledger-${l._id}`}>
                      <td className="p-3"><span className="chip bg-navy-800 text-slate-300 border-navy-600">{l.type}</span></td>
                      <td className={`p-3 num font-bold ${l.direction === "credit" ? "text-green-300" : "text-rose-400"}`}>
                        {l.direction === "credit" ? "+" : "−"}{sar(l.amount)}
                      </td>
                      <td className="p-3 text-xs text-slate-400">{l.actor}</td>
                      <td className="p-3 text-xs text-slate-400 max-w-[260px] truncate">{l.note}</td>
                      <td className="p-3 text-xs text-slate-500 num">{new Date(l.created_at).toLocaleString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === "invoices" && (
        !invoices ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : invoices.length === 0 ? (
          <EmptyState icon={FileText} title={t("fin.noInvoices")} testid="invoices-empty" />
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div key={inv._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`invoice-${inv._id}`}>
                <FileText className="w-5 h-5 text-brand shrink-0" />
                <span className="font-heading font-bold num">{inv.number}</span>
                <span className="text-sm">{inv.business?.business_profile?.company_name || inv.business?.name}</span>
                <span className="text-xs text-slate-400">{t("fin.gross")}: <span className="num">{sar(inv.gross)}</span> · {t("fin.commission")}: <span className="num">{sar(inv.commission)}</span> · {t("fin.vat")}: <span className="num">{sar(inv.vat)}</span></span>
                <span className="text-xs text-slate-500 num ms-auto">{new Date(inv.created_at).toLocaleDateString(locale)}</span>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "batches" && (
        !batches ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : batches.length === 0 ? (
          <EmptyState icon={Banknote} title={t("finx.noBatches")} testid="batches-empty" />
        ) : (
          <div className="space-y-2" data-testid="batches-list">
            {batches.map((b) => (
              <div key={b._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`batch-${b._id}`}>
                <Banknote className="w-5 h-5 text-brand shrink-0" />
                <span className="font-heading font-bold num">{b.reference}</span>
                <span className="chip bg-navy-800 text-slate-300 border-navy-600">{t(`finx.period_${b.period_type}`)} · <span className="num">{b.period_key}</span></span>
                <span className="text-xs text-slate-400">{t("finx.countL")}: <span className="num">{b.count}</span></span>
                <span className="text-sm font-bold text-brand num">{sar(b.total)}</span>
                <span className="text-xs text-slate-500 ms-auto">{b.executed_by?.name} · <span className="num">{new Date(b.created_at).toLocaleString(locale)}</span></span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
