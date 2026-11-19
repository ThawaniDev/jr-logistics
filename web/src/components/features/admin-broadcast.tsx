"use client";
import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button, Modal, Notice, Section, Select, Textarea, useAction } from "@/components/ui";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";

/** Staff broadcast to a whole audience. Needs `broadcast.send`; asks for confirmation because it cannot be recalled. */
export function BroadcastCard() {
  const { t } = useI18n(); const a = useAction();
  const [role, setRole] = useState("all"); const [message, setMessage] = useState(""); const [ask, setAsk] = useState(false); const [sent, setSent] = useState<number | null>(null);
  const ok = message.trim().length >= 3;
  const send = () => a.run("bc", () => post("/admin/broadcast", { role, message: message.trim() }), { onDone: (r: any) => { setSent(r.sent ?? 0); setMessage(""); setAsk(false); } });
  const audience = role === "all" ? t("adm.audience_all") : t(`role.${role}`);
  return (
    <Section id="broadcast" title={<span className="flex items-center gap-2"><Megaphone className="size-5 text-accent" aria-hidden />{t("adm.broadcast")}</span>} description={t("adm.broadcast_hint")} className="scroll-mt-20">
      <div className="space-y-4" data-testid="admin-broadcast">
        {sent !== null && <Notice tone="success">{t("adm.broadcast_sent", { n: sent })}</Notice>}
        <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
          <Select label={t("adm.audience")} data-testid="admin-broadcast-audience" options={[{ value: "all", label: t("adm.audience_all") }, ...["business", "driver", "office"].map((r) => ({ value: r, label: t(`role.${r}`) }))]} value={role} onChange={(e) => setRole(e.target.value)} />
          <Textarea label={t("adm.message")} data-testid="admin-broadcast-message" maxLength={300} value={message} onChange={(e) => { setMessage(e.target.value); setSent(null); }} hint={`${message.length}/300`} />
        </div>
        <Button data-testid="admin-broadcast-send" disabled={!ok} onClick={() => setAsk(true)}>{t("common.send")}</Button>
      </div>
      <Modal open={ask} onClose={() => setAsk(false)} title={t("adm.broadcast_confirm_title")} footer={<><Button variant="ghost" onClick={() => setAsk(false)}>{t("common.cancel")}</Button><Button data-testid="admin-broadcast-confirm" loading={a.is("bc")} onClick={send}>{t("common.send")}</Button></>}>
        <p className="text-sm">{t("adm.broadcast_confirm", { audience })}</p>
        <p className="rounded-xl bg-bg2 p-3 text-sm">{message}</p>
      </Modal>
    </Section>
  );
}
