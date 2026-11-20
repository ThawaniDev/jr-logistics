"use client";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n/provider";

/**
 * One section of a portal report. The server answers each section independently: when one could not be computed (a timeout, a bug) it arrives as `null`, and only this
 * card says so while every other section of the page still renders (decision G11). `title` names the section for the unavailable card.
 */
export function Guarded<T>({ data, title, testId, children }: { data: T | null | undefined; title: string; testId?: string; children: (d: T) => ReactNode }) {
  const { t } = useI18n();
  if (data == null) {
    return (
      <section aria-label={title} data-testid={testId ? `${testId}-unavailable` : "section-unavailable"} className="min-w-0 rounded-card border border-line bg-card p-4 sm:p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />{t("rpr.section_failed")}</p>
      </section>
    );
  }
  return <>{children(data)}</>;
}
