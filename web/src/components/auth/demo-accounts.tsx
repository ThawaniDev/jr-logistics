"use client";
import { FlaskConical } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/provider";

/** Rendered only when the server runs in explicit DEMO_MODE (never in production). */
export function DemoAccounts({ onPick, staff }: { onPick: (v: { phone?: string; email?: string; password?: string }) => void; staff?: boolean }) {
  const t = useT();
  const { data } = useApi<{ items: Array<{ role: string; name: string; phone: string | null; email: string | null; password?: string }>; staffPassword: string }>("/auth/demo-accounts", { shouldRetryOnError: false });
  if (!data?.items?.length) return null;
  const items = data.items.filter((i) => (staff ? i.email : i.phone));
  return (
    <Card className="mt-6 border-gold/40 bg-gold/5">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold"><FlaskConical className="size-4" aria-hidden />{t("auth.demo_title")}</p>
      <p className="mb-3 text-xs text-muted">{t("auth.demo_hint")}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <button key={(i.phone ?? i.email) as string} type="button" onClick={() => onPick(staff ? { email: i.email!, password: i.password ?? data.staffPassword } : { phone: i.phone! })} className="rounded-lg border border-line bg-bg2 px-3 py-1.5 text-xs hover:border-accent">
            <span className="font-medium">{i.name}</span> <span className="text-muted">· {t(`role.${i.role}`)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
