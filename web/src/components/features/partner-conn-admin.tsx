"use client";
import { useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plug } from "lucide-react";
import { Breadcrumbs, Button, EmptyState, ErrorState, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import type { Connection, Provider } from "./business-shipments-partner";
import { adminScope, connApi, type FreshView } from "./partner-conn-lib";
import { ConnectionShell } from "./partner-conn-detail";
import { FreshTokenCard } from "./partner-conn-fresh";
import { hasAny } from "./admin-common";

/** Staff may look at connections with `integrations.view` (or the older `requests.view`); changing them needs `integrations.manage`. */
export const canViewIntegrations = (u: Parameters<typeof hasPerm>[0]) => hasAny(u, "integrations.view", "requests.view");
export const canManageIntegrations = (u: Parameters<typeof hasPerm>[0]) => hasPerm(u, "integrations.manage");

/**
 * `/admin/integrations/:id` layout: loads one company's connection through the staff API and renders the same connection screens the company
 * sees (setup · sync & statuses · orders · activity · failed updates), read-only without `integrations.manage`.
 */
export function AdminConnectionShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n(); const me = useUser(); const router = useRouter();
  const allowed = canViewIntegrations(me);
  const scope = useMemo(() => adminScope(canManageIntegrations(me)), [me]);
  const conn = useApi<Connection>(allowed ? connApi(scope, id) : null, { shouldRetryOnError: false, refreshInterval: 60000 });
  const prov = useApi<{ items: Provider[] }>(allowed ? "/integrations/providers" : null);
  const [fresh, setFresh] = useState<FreshView | null>(null);
  if (!allowed) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  const gone = conn.error instanceof ApiError && (conn.error.code === "NOT_FOUND" || conn.error.code === "VALIDATION");
  if (gone) return <><Breadcrumbs items={[{ label: t("nav.integrations"), href: scope.routeBase }]} /><EmptyState icon={<Plug className="size-9" aria-hidden />} title={t("intg.not_found")} action={<Button onClick={() => router.push(scope.routeBase)}>{t("intg.back_list")}</Button>} /></>;
  if (conn.error && !conn.data) return <ErrorState error={conn.error} retry={() => conn.mutate()} />;
  if (prov.error) return <ErrorState error={prov.error} retry={() => prov.mutate()} />;
  if (!conn.data || !prov.data) return <PageLoading />;
  const providers = prov.data.items;
  return (
    <>
      {fresh && <FreshTokenCard fresh={fresh} provider={providers.find((p) => p.key === fresh.conn.provider)} scope={scope} onDone={() => setFresh(null)} onChanged={() => { void conn.mutate(); }} />}
      <ConnectionShell scope={scope} conn={conn.data} providers={providers} reload={() => conn.mutate()} onFresh={setFresh}>{children}</ConnectionShell>
    </>
  );
}
