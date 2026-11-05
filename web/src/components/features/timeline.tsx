"use client";
import { Card, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export function Timeline({ events }: { events: Array<{ id: string; type: string; actorName: string | null; actorRole: string; createdAt: string; payload?: any }> }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <h3 className="mb-4 font-semibold">{t("timeline.title")}</h3>
      {events.length === 0 ? <EmptyState title={t("timeline.empty")} /> : (
        <ol className="relative space-y-4 border-s border-line ps-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-accent ring-4 ring-card" aria-hidden />
              <p className="text-sm font-medium">{t(`event.${e.type}`)}</p>
              <p className="text-xs text-muted">{e.actorName ? `${e.actorName} · ` : ""}{t(`role.${e.actorRole}`)} · {fmtDateTime(e.createdAt, locale)}</p>
              {e.payload?.reason && <p className="mt-1 text-xs text-muted">“{e.payload.reason}”</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
