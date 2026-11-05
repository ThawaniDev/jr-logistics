"use client";
import { useRef, useState } from "react";
import { FileCheck2, Upload, ExternalLink } from "lucide-react";
import { Badge, Button, Card, ErrorState, Input, Notice, PageHeader, PageLoading, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export function DocumentsPage() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const { data: cat } = useApi("/catalog"); const { data, error, mutate } = useApi("/documents");
  const { data: prof } = useApi("/profile");
  const [expiry, setExpiry] = useState<Record<string, string>>({}); const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !cat) return <PageLoading />;
  const kind = me.role === "driver" ? "driver" : me.role === "office" ? "office" : "business";
  const types: Array<{ key: string; required: boolean }> = cat.documents[kind];
  const vs = prof?.profile?.verificationStatus;
  async function upload(type: string, file: File) {
    const fd = new FormData(); fd.set("type", type); fd.set("file", file); if (expiry[type]) fd.set("expiresOn", expiry[type]);
    await a.run(type, () => post("/documents", fd), { success: "docs.uploaded", onDone: () => mutate() });
  }
  return (
    <>
      <PageHeader title={t("nav.documents")} subtitle={t("docs.sub")} actions={vs && <StatusBadge status={vs} />} />
      {vs === "verified" ? <div className="mb-5"><Notice tone="success">{t("docs.verified_note")}</Notice></div> : <div className="mb-5"><Notice tone="warn">{t("docs.pending_note")}</Notice></div>}
      <div className="grid gap-4 md:grid-cols-2">
        {types.map((ty) => {
          const mine = data.items.filter((d: any) => d.type === ty.key);
          const latest = mine[0];
          return (
            <Card key={ty.key} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2"><FileCheck2 className="size-5 text-accent" aria-hidden /><p className="font-semibold">{t(`doc.${ty.key}`)}</p></div>
                {ty.required ? <Badge tone="warn">{t("docs.required")}</Badge> : <Badge>{t("docs.optional")}</Badge>}
              </div>
              {latest ? (
                <div className="space-y-1 rounded-xl bg-bg2 p-3 text-sm">
                  <div className="flex items-center justify-between"><StatusBadge status={latest.status} ns="docstatus" /><a href={`/api/v1/documents/${latest.id}/file`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-cyan hover:underline">{t("docs.view")}<ExternalLink className="size-3" /></a></div>
                  {latest.expiresOn && <p className="text-xs text-muted">{t("docs.expires")}: {fmtDate(latest.expiresOn, locale)}</p>}
                  {latest.reviewNote && <p className="text-xs text-gold">{latest.reviewNote}</p>}
                </div>
              ) : <p className="text-sm text-muted">{t("docs.none")}</p>}
              <Input label={t("docs.expiry_optional")} type="date" ltr min={new Date().toISOString().slice(0, 10)} value={expiry[ty.key] ?? ""} onChange={(e) => setExpiry({ ...expiry, [ty.key]: e.target.value })} />
              <input ref={(el) => { inputs.current[ty.key] = el; }} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(ty.key, f); e.target.value = ""; }} />
              <Button variant="secondary" full loading={a.is(ty.key)} onClick={() => inputs.current[ty.key]?.click()}><Upload className="size-4" />{latest ? t("docs.replace") : t("docs.upload")}</Button>
            </Card>
          );
        })}
      </div>
    </>
  );
}
