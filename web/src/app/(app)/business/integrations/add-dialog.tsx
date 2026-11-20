"use client";
import type { Connection, FreshCredentials, Provider } from "@/components/features/business-shipments-partner";
import { AddConnectionDialog } from "@/components/features/partner-conn-add";
import { BUSINESS_SCOPE } from "@/components/features/partner-conn-lib";

/** Company portal: add one of the company's own connections. Mount only while open. */
export function AddDialog({ providers, onClose, onCreated }: { providers: Provider[]; onClose: () => void; onCreated: (c: Connection, creds: FreshCredentials | null) => void }) {
  return <AddConnectionDialog providers={providers} scope={BUSINESS_SCOPE} onClose={onClose} onCreated={(c, creds) => onCreated(c, creds)} />;
}
