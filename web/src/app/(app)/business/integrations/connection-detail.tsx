"use client";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plug } from "lucide-react";
import { Breadcrumbs, Button, EmptyState } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { ConnectionShell as SharedConnectionShell } from "@/components/features/partner-conn-detail";
import { BUSINESS_SCOPE } from "@/components/features/partner-conn-lib";
import { useIntegrations } from "./shell";

export { SetupTab, useConnection } from "@/components/features/partner-conn-detail";

/** Company portal: one of the company's connections (read from the shared list the layout loaded) in the shared connection screens. */
export function ConnectionShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n(); const router = useRouter();
  const { providers, conns, reload, setFresh } = useIntegrations();
  const conn = conns.find((c) => c.id === id);
  if (!conn) return <><Breadcrumbs items={[{ label: t("nav.integrations"), href: BUSINESS_SCOPE.routeBase }]} /><EmptyState icon={<Plug className="size-9" aria-hidden />} title={t("intg.not_found")} action={<Button onClick={() => router.push(BUSINESS_SCOPE.routeBase)}>{t("intg.back_list")}</Button>} /></>;
  return <SharedConnectionShell scope={BUSINESS_SCOPE} conn={conn} providers={providers} reload={reload} onFresh={setFresh}>{children}</SharedConnectionShell>;
}
