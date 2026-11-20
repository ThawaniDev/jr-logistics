"use client";
import { useState } from "react";
import { Badge, Button, Modal, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

/** Pin distance above which the delivery is flagged for audit (metres). It never blocks anything. */
export const PIN_FLAG_M = 500;
const STATUS_TONE: Record<string, "neutral" | "info" | "warn" | "success" | "danger"> = { pending: "neutral", loaded: "info", delivered: "success", failed: "danger", returned: "warn", missing: "danger", cancelled: "neutral" };

export function ShipStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`shipstatus.${status}`)}</Badge>;
}

/** Per-offer parcel counters, one compact line. */
export function ParcelStats({ parcels }: { parcels: { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number } | null | undefined }) {
  const { t } = useI18n();
  if (!parcels) return null;
  return <p className="text-xs text-muted">{t("shipadm.parcel_stats", { total: parcels.total, delivered: parcels.delivered, loaded: parcels.loaded, failed: parcels.failed, returned: parcels.returned, missing: parcels.missing })}</p>;
}

/** Receipt photo of a business recipient (GET /shipments/:id/proof). Rendered only while open so nothing is fetched otherwise. */
export function ReceiptDialog({ shipment, onClose }: { shipment: { id: string; code: string; receiverName?: string | null } | null; onClose: () => void }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !!shipment && failed === shipment.id;
  return (
    <Modal open={!!shipment} onClose={onClose} title={t("shipadm.receipt_title", { code: shipment?.code ?? "" })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      {shipment && (bad ? <Notice tone="danger">{t("shipadm.receipt_error")}</Notice> : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin image, not optimisable */}
          <img src={`/api/v1/shipments/${shipment.id}/proof`} alt={t("shipadm.receipt_alt", { code: shipment.code })} className="mx-auto max-h-[70vh] w-auto rounded-xl border border-line" onError={() => setFailed(shipment.id)} />
          {shipment.receiverName && <p className="text-sm text-muted">{t("shipadm.received_by", { name: shipment.receiverName })}</p>}
        </>
      ))}
    </Modal>
  );
}
