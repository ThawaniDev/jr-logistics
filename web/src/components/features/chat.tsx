"use client";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button, Card, EmptyState, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { fmtTime } from "@/lib/format";
import { useUser } from "@/components/layout/auth-context";
import { cn } from "@/lib/cn";
import { toast } from "sonner";

/** In-app job room: replaces phone exposure; polling keeps it simple and reliable. */
export function JobChat({ offerId, closed }: { offerId: string; closed?: boolean }) {
  const { t, locale } = useI18n(); const me = useUser();
  const { data, mutate } = useApi(`/offers/${offerId}/messages`, { refreshInterval: 8000 });
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [data?.items?.length]);
  async function send() {
    if (!text.trim()) return; setBusy(true);
    try { await post(`/offers/${offerId}/messages`, { body: text }); setText(""); await mutate(); } catch (e) { toast.error(errText(e, t)); } finally { setBusy(false); }
  }
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">{t("chat.title")}</div>
      <div className="max-h-72 min-h-40 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {!data?.items?.length ? <EmptyState title={t("chat.empty")} /> : data.items.map((m: any) => (
          <div key={m.id} className={cn("flex", m.senderId === me.id ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.senderId === me.id ? "bg-accent/15 text-ink" : "bg-bg2")}>
              {m.senderId !== me.id && <p className="mb-0.5 text-[11px] text-muted">{m.senderName} · {t(`role.${m.senderRole}`)}</p>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p><p className="mt-1 text-end text-[10px] text-muted">{fmtTime(m.createdAt, locale)}</p>
            </div>
          </div>
        ))}<div ref={end} />
      </div>
      {!closed && (
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t("chat.placeholder")} aria-label={t("chat.placeholder")} className="h-10 flex-1 rounded-xl border border-line bg-bg2 px-3 text-sm focus:border-accent" />
          <Button type="submit" loading={busy} aria-label={t("chat.send")}><Send className="size-4 rtl:-scale-x-100" /></Button>
        </form>
      )}
    </Card>
  );
}
