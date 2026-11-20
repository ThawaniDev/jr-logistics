"use client";
import { FlaskConical } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/provider";

/** Rendered only when the server runs in explicit DEMO_MODE (never in production): one button per demo account that fills in its username and password. */
export function DemoAccounts({ onPick }: { onPick: (v: { username: string; password: string }) => void }) {
  const t = useT();
  const { data } = useApi<{ items: Array<{ role: string; name: string; username: string; password: string }> }>("/auth/demo-accounts", { shouldRetryOnError: false });
  if (!data?.items?.length) return null;
  return (
    <Card className="mt-6 border-gold/40 bg-gold/5" data-testid="demo-accounts">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold"><FlaskConical className="size-4" aria-hidden />{t("auth.demo_title")}</p>
      <p className="mb-3 text-xs text-muted">{t("auth.demo_hint")}</p>
      <div className="flex flex-wrap gap-2">
        {data.items.map((i) => (
          <button key={i.username} type="button" data-testid={`demo-${i.username}`} onClick={() => onPick({ username: i.username, password: i.password })} className="min-h-10 rounded-lg border border-line bg-bg2 px-3 py-1.5 text-xs hover:border-accent">
            <span className="font-medium">{i.name}</span> <span className="text-muted">· {t(`role.${i.role}`)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
