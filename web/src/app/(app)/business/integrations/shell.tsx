"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ErrorState, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { usePartnerConnections, type Connection, type Provider } from "@/components/features/business-shipments-partner";
import { FreshTokenCard, type Fresh } from "./fresh-token";

interface IntegrationsCtx { providers: Provider[]; conns: Connection[]; reload: () => void; setFresh: (f: Fresh | null) => void }
const Ctx = createContext<IntegrationsCtx | null>(null);
export function useIntegrations(): IntegrationsCtx { const c = useContext(Ctx); if (!c) throw new Error("useIntegrations outside the integrations layout"); return c; }

/** Loads the connections + the catalogue once for the list and every connection page, and keeps the "show the token once" card on top of both. */
export function IntegrationsShell({ children }: { children: ReactNode }) {
  const prov = useApi<{ items: Provider[] }>("/integrations/providers");
  const conns = usePartnerConnections();
  const [fresh, setFresh] = useState<Fresh | null>(null);
  if (conns.error) return <ErrorState error={conns.error} retry={() => conns.mutate()} />;
  if (prov.error) return <ErrorState error={prov.error} retry={() => prov.mutate()} />;
  if (!conns.data || !prov.data) return <PageLoading />;
  const providers = prov.data.items; const reload = () => { void conns.mutate(); };
  return (
    <Ctx.Provider value={{ providers, conns: conns.items, reload, setFresh }}>
      {fresh && <FreshTokenCard fresh={fresh} provider={providers.find((p) => p.key === fresh.conn.provider)} onDone={() => setFresh(null)} onChanged={reload} />}
      {children}
    </Ctx.Provider>
  );
}
