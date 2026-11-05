"use client";
import { Building2 } from "lucide-react";
import { Button, Card, Notice, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ProfilePage } from "@/components/features/profile";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";

export default function Page() {
  const { t } = useI18n(); const a = useAction();
  const inv = useApi("/driver/invites"); const prof = useApi("/profile");
  const respond = (id: string, accept: boolean) => a.run(id + accept, () => post(`/driver/invites/${id}/respond`, { accept }), { success: "common.saved", onDone: () => { inv.mutate(); prof.mutate(); } });
  return (
    <div className="space-y-6">
      {prof.data?.profile?.officeLinkStatus === "linked" && <Notice tone="info">{t("driver.linked_note")}</Notice>}
      {inv.data?.items?.map((i: any) => (
        <Card key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-cyan/40">
          <div className="flex items-center gap-3"><Building2 className="size-6 text-cyan" /><div><p className="font-semibold">{t("driver.invite_from", { name: i.officeName })}</p><p className="text-xs text-muted">{t("driver.invite_effect")}</p></div></div>
          <div className="flex gap-2"><Button loading={a.is(i.id + true)} onClick={() => respond(i.id, true)}>{t("act.accept")}</Button><Button variant="secondary" loading={a.is(i.id + false)} onClick={() => respond(i.id, false)}>{t("act.decline")}</Button></div>
        </Card>
      ))}
      <ProfilePage />
    </div>
  );
}
