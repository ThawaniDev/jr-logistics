"use client";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { useOrder } from "./admin-order-ctx";

/** Activity: the full shared log of the order (events, parcels, chat, notifications, money, support, ratings, notes, messages, integration, audit), internal notes, and the raw record for support. */
export function OrderActivity() {
  const { t } = useI18n();
  const { id, data } = useOrder();
  const offers = useApi(`/admin/requests/${id}/offers`, { shouldRetryOnError: false });
  const raw = { ...data.request, company: data.company, flags: data.flags, milestones: data.milestones, offers: (offers.data?.items ?? []).map((o: any) => ({ id: o.id, status: o.status, source: o.source, driverId: o.driver.id, officeId: o.officeId, createdAt: o.createdAt, acceptedAt: o.acceptedAt, arrivedAt: o.arrivedAt, loadedAt: o.loadedAt, routeApprovedAt: o.routeApprovedAt, deliveredAt: o.deliveredAt, finalAt: o.finalAt, cancelReason: o.cancelReason, routePlan: o.routePlan })) };
  return (
    <div className="space-y-5" data-testid="dv1-activity">
      <ActivityLog entity="request" id={id} />
      <NotesPanel entity="request" id={id} />
      <RawDataPanel data={raw} title={t("dv1.raw_title")} />
    </div>
  );
}
