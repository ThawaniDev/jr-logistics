import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plug, PlusCircle, Trash2, Copy, KeyRound, Webhook } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function BusinessApi() {
  const { t, lang } = useI18n();
  const { user, refresh } = useAuth();
  const [keys, setKeys] = useState(null);
  const [totalCalls, setTotalCalls] = useState(0);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState(null);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";
  const baseUrl = process.env.REACT_APP_BACKEND_URL;

  const load = () =>
    api.get("/business/api-keys").then(({ data }) => { setKeys(data.keys); setTotalCalls(data.total_calls); })
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
    setWebhook(user?.business_profile?.webhook_url || "");
  }, [user?._id]);

  const createKey = async () => {
    if (!name.trim()) return toast.error(t("apix.keyName"));
    setBusy(true);
    try {
      const { data } = await api.post("/business/api-keys", { name });
      setNewKey(data.api_key);
      setName("");
      toast.success(t("apix.created"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    setBusy(true);
    try {
      await api.post(`/business/api-keys/${id}/revoke`);
      toast.success(t("apix.revoked"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const saveWebhook = async () => {
    setBusy(true);
    try {
      await api.patch("/profile", { webhook_url: webhook });
      toast.success(t("apix.saved"));
      refresh?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="business-api-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Plug className="w-6 h-6 text-brand" /> {t("apix.title")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("apix.sub")}</p>
      </div>

      <div className="card-surface p-6 space-y-4" data-testid="api-key-create">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-slate-400 block mb-1.5">{t("apix.keyName")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="api-key-name"
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <button onClick={createKey} disabled={busy} data-testid="api-key-create-btn"
            className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 h-11 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
            <PlusCircle className="w-4 h-4" /> {t("apix.create")}
          </button>
        </div>
        {newKey && (
          <div className="bg-brand/5 border border-brand/30 rounded-xl p-4 space-y-2" data-testid="api-key-reveal">
            <p className="text-xs text-amber-400 font-semibold">{t("apix.copyNow")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-xs num break-all" dir="ltr" data-testid="api-key-value">{newKey}</code>
              <button onClick={() => { navigator.clipboard?.writeText(newKey); toast.success(t("apix.created")); }}
                data-testid="api-key-copy"
                className="shrink-0 border border-navy-600 rounded-lg p-2 text-slate-300 hover:text-brand hover:border-brand/40 transition-colors">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {!keys ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : keys.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("apix.empty")} desc={t("apix.emptyDesc")} testid="api-keys-empty" />
      ) : (
        <div className="space-y-2" data-testid="api-keys-list">
          <p className="text-xs text-slate-500">{t("apix.totalCalls")}: <span className="num">{totalCalls}</span></p>
          {keys.map((k) => (
            <div key={k._id} className="card-surface p-4 flex flex-wrap items-center gap-3" data-testid={`api-key-${k._id}`}>
              <KeyRound className="w-4 h-4 text-brand shrink-0" />
              <div className="flex-1 min-w-[180px]">
                <p className="font-semibold text-sm">{k.name}</p>
                <p className="text-[11px] text-slate-500 num" dir="ltr">{k.prefix}… · {t("apix.lastUsed")}: {k.last_used_at ? new Date(k.last_used_at).toLocaleString(locale) : t("apix.never")}</p>
              </div>
              <span className={`chip ${k.status === "active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-slate-700/40 text-slate-400 border-slate-600/40"}`}>
                {t(`apix.st_${k.status}`)}
              </span>
              {k.status === "active" && (
                <button onClick={() => revoke(k._id)} disabled={busy} data-testid={`api-key-revoke-${k._id}`}
                  className="flex items-center gap-1.5 text-xs border border-rose-500/40 text-rose-400 rounded-lg px-3 py-1.5 hover:bg-rose-500/10 disabled:opacity-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> {t("apix.revoke")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card-surface p-6 space-y-3" data-testid="webhook-section">
        <p className="font-heading font-bold flex items-center gap-2">
          <Webhook className="w-4 h-4 text-brand" /> {t("apix.webhookUrl")}
        </p>
        <div className="flex flex-wrap gap-3">
          <input value={webhook} onChange={(e) => setWebhook(e.target.value)} dir="ltr" data-testid="webhook-url-input"
            placeholder="https://your-system.sa/webhooks/jr"
            className="flex-1 min-w-[260px] bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm text-left focus:outline-none focus:ring-1 focus:ring-brand" />
          <button onClick={saveWebhook} disabled={busy} data-testid="webhook-save-btn"
            className="bg-brand text-navy-900 font-bold rounded-xl px-5 h-11 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
            {t("apix.save")}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">{t("apix.webhookNote")}</p>
      </div>

      <div className="card-surface p-6 space-y-2" data-testid="api-docs">
        <p className="font-heading font-bold">{t("apix.docs")}</p>
        <p className="text-xs text-slate-400">{t("apix.headerNote")}: <code className="num" dir="ltr">X-API-Key: jrk_...</code></p>
        <p className="text-xs text-slate-400">Base URL: <code className="num" dir="ltr">{baseUrl}</code></p>
        {[t("apix.ep1"), t("apix.ep2"), t("apix.ep3"), t("apix.ep4")].map((ep) => (
          <p key={ep} className="text-xs text-slate-300 num" dir="ltr">{ep}</p>
        ))}
      </div>
    </div>
  );
}
