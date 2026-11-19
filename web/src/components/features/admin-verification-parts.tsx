"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";

/** Icon-only row action (the label is the tooltip and the accessible name), so a row of decisions stays on one line in a table cell. */
export function IconAction({ label, variant = "secondary", loading, onClick, testId, children }: { label: string; variant?: "secondary" | "gold" | "danger" | "ghost"; loading?: boolean; onClick: () => void; testId?: string; children: ReactNode }) {
  return <Button size="sm" variant={variant} aria-label={label} title={label} loading={loading} onClick={onClick} data-testid={testId} className="w-8 px-0 pointer-coarse:w-10">{children}</Button>;
}
