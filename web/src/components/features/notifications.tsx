"use client";
import { useEffect } from "react";
import { BellOff } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoading } from "@/components/ui";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { mutate } from "swr";
import { cn } from "@/lib/cn";

export function NotificationsPage() {
  const { t, locale } = useI18n();
  const { data, error, mutate: reload } = useApi("/notifications");
  useEffect(() => { if (data?.unread > 0) { const id = setTimeout(() => { post("/notifications/read").then(() => { reload(); mutate("/notifications?unread=1"); }); }, 2500); return () => clearTimeout(id); } }, [data?.unread, reload]);
  if (error) return <ErrorState error={error} retry={() => reload()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.notifications")} actions={data.unread > 0 && <Button variant="secondary" size="sm" onClick={() => post("/notifications/read").then(() => { reload(); mutate("/notifications?unread=1"); })}>{t("notif.mark_all")}</Button>} />
      {data.items.length === 0 ? <EmptyState icon={<BellOff className="size-9" />} title={t("notif.empty")} /> : (
        <div className="space-y-2">
          {data.items.map((n: any) => (
            <Card key={n.id} className={cn("flex items-start gap-3 p-4", !n.readAt && "border-accent/40")}>
              {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t(`notif.${n.type}`, flat(n.data))}</p><p className="mt-0.5 text-xs text-muted">{fmtDateTime(n.createdAt, locale)}</p></div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
function flat(d: Record<string, unknown> | null) { return Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, typeof v === "object" ? "" : String(v)])); }
