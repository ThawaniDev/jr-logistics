"use client";
import { Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

/** Opens the browser's print dialog; the print stylesheet of the sheet makes it print only the invoice (the dialog also offers "Save as PDF"). */
export function PrintButton() {
  const { t } = useI18n();
  return <Button variant="secondary" onClick={() => window.print()} data-testid="inv-print"><Printer className="size-4" aria-hidden />{t("inv.print")}</Button>;
}

/** Copies the invoice number and says so (clipboard access can be refused: the number stays selectable on the page). */
export function CopyNumberButton({ number }: { number: string }) {
  const { t } = useI18n();
  const copy = async () => { try { await navigator.clipboard.writeText(number); toast.success(t("common.copied")); } catch { toast.error(t("uxa.copy_failed")); } };
  return <Button variant="secondary" onClick={copy} data-testid="inv-copy"><Copy className="size-4" aria-hidden />{t("inv.copy_number")}</Button>;
}
