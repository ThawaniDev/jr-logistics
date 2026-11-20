"use client";
import type { Provider } from "@/components/features/business-shipments-partner";
import { FreshTokenCard as SharedFreshTokenCard } from "@/components/features/partner-conn-fresh";
import { BUSINESS_SCOPE, type FreshView } from "@/components/features/partner-conn-lib";

/** What a create / rotate handed over once (connection + credentials). */
export type Fresh = FreshView;

export function FreshTokenCard({ fresh, provider, onDone, onChanged }: { fresh: Fresh; provider: Provider | undefined; onDone: () => void; onChanged: () => void }) {
  return <SharedFreshTokenCard fresh={fresh} provider={provider} scope={BUSINESS_SCOPE} onDone={onDone} onChanged={onChanged} />;
}
