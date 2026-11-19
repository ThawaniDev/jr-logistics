"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Plug, PlugZap, Plus, TriangleAlert } from "lucide-react";
import { Badge, Button, EmptyState, PageHeader, PageLoading, Section, Stat, StatGrid } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { Connection, Provider } from "@/components/features/business-shipments-partner";
import { usePartnerConnections } from "@/components/features/business-shipments-partner";
import { AddDialog } from "./add-dialog";
import { useIntegrations } from "./shell";
import { DocsLink, Health, LimitsBox, TestResult, providerName, useTest } from "./parts";

const MAX_CONNECTIONS = 5;

export default function IntegrationsPage() { return <Suspense fallback={<PageLoading />}><Integrations /></Suspense>; }

function Integrations() {
  const { t } = useI18n(); const router = useRouter(); const legacy = useSearchParams().get("c");
  const { providers, conns, reload, setFresh } = useIntegrations();
  const [adding, setAdding] = useState(false);
  // Older links (`?c=<id>`) open the connection's own page.
  useEffect(() => { if (legacy) router.replace(`/business/integrations/${legacy}`); }, [legacy, router]);
  if (legacy) return <PageLoading />;
  const providerOf = (c: Connection) => providers.find((p) => p.key === c.provider);
  const full = conns.length >= MAX_CONNECTIONS;
  const paused = conns.filter((c) => c.status === "disabled").length;
  const failing = conns.filter((c) => c.status === "active" && c.lastError).length;
  const healthy = conns.filter((c) => c.status === "active" && !c.lastError && c.lastOkAt).length;
  return (
    <>
      <PageHeader title={t("nav.integrations")} subtitle={t("intg.sub")}
        actions={<Button onClick={() => setAdding(true)} disabled={full || providers.length === 0} data-testid="add-connection"><Plus className="size-4" aria-hidden />{t("intg.add")}</Button>} />
      {conns.length > 0 && (
        <StatGrid cols={4} className="mb-6">
          <Stat label={t("rdz.int_k_connections")} value={<span className="ltr-num">{conns.length}/{MAX_CONNECTIONS}</span>} hint={full ? t("intg.max_reached", { n: MAX_CONNECTIONS }) : t("rdz.int_k_connections_hint")} icon={<Plug className="size-5" />} tone="cyan" />
          <Stat label={t("rdz.int_k_healthy")} value={healthy} hint={t("rdz.int_k_healthy_hint")} icon={<CheckCircle2 className="size-5" />} tone={healthy > 0 ? "accent" : "muted"} />
          <Stat label={t("rdz.int_k_failing")} value={failing} hint={failing > 0 ? t("rdz.int_k_failing_hint") : t("rdz.int_k_none_failing")} icon={<TriangleAlert className="size-5" />} tone={failing > 0 ? "danger" : "muted"} />
          <Stat label={t("rdz.int_k_paused")} value={paused} hint={t("rdz.int_k_paused_hint")} icon={<PlugZap className="size-5" />} tone={paused > 0 ? "gold" : "muted"} />
        </StatGrid>
      )}
      <div className="mb-6"><LimitsBox providers={providers} /></div>
      {providers.length === 0 ? <EmptyState icon={<Plug className="size-9" aria-hidden />} title={t("intg.no_providers")} />
        : conns.length === 0 ? (
          <EmptyState icon={<PlugZap className="size-10" aria-hidden />} title={t("intg.empty_title")} hint={t("intg.empty_hint")}
            action={<Button onClick={() => setAdding(true)} data-testid="add-first"><Plus className="size-4" aria-hidden />{t("intg.add_first")}</Button>} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2" aria-label={t("nav.integrations")}>
            {conns.map((c) => <li key={c.id}><ConnectionCard conn={c} provider={providerOf(c)} /></li>)}
          </ul>
        )}
      {adding && <AddDialog providers={providers} onClose={() => setAdding(false)} onCreated={(c, token) => { setAdding(false); reload(); if (token) setFresh({ conn: c, token, webhookUrl: c.webhookUrl ?? "", kind: "created" }); else router.push(`/business/integrations/${c.id}`); }} />}
    </>
  );
}

function ConnectionCard({ conn, provider }: { conn: Connection; provider: Provider | undefined }) {
  const { t } = useI18n(); const { mutate } = usePartnerConnections();
  const test = useTest(conn, () => { void mutate(); });
  const name = providerName(t, conn.provider, conn.providerLabel);
  return (
    <div data-testid="connection-card" className="h-full"><Section title={<span className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan/10 text-cyan" aria-hidden><Plug className="size-5" /></span><span className="min-w-0"><span className="block truncate">{conn.name}</span><span className="block text-xs font-normal text-muted">{name}</span></span></span>}
      actions={<Badge tone={conn.status === "active" ? "success" : "neutral"}>{t(conn.status === "active" ? "intg.st_active" : "intg.st_disabled")}</Badge>} className="h-full">
      <div className="flex h-full flex-col gap-4">
        <Health c={conn} compact />
        {test.result && <TestResult r={test.result} name={name} />}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" loading={test.busy} onClick={test.run} data-testid="card-test"><PlugZap className="size-4" aria-hidden />{t("intg.test")}</Button>
          <Link href={`/business/integrations/${conn.id}`} className="ms-auto"><Button size="sm" variant="ghost" data-testid="manage-connection">{t("intg.manage")}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Button></Link>
        </div>
        {provider?.docsUrl && <DocsLink href={provider.docsUrl} />}
      </div>
    </Section></div>
  );
}
