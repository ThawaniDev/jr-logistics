"use client";
import { toast } from "sonner";
import { Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { RouteSummary } from "./driver-route";
import { LoadingScan, LoadingWaiting } from "./driver-loading";
import { ReorderOff, ReorderSection } from "./driver-reorder";
import { RouteMapPanel } from "./route-map-panel";
import { ShipmentsBoard } from "./driver-shipments";
import { useRouteView } from "./driver-route-view";
import { ShipHeader } from "./driver-ship-header";
import { cashCollected, cashToCollect, routingEnabledOf, shipCounters } from "./driver-shipments-lib";
import { loadingOf, movableStops, policyOf } from "./driver-fieldops-utils";
import { AckCard, EndRoute, FinishCard, PostRoute, RouteReview, RouteReviewBar, ViewTabs, WaitingHandover } from "./driver-stops-steps";
import { orderStops, progressOf, type RouteInfo, type Stop, type StopsSummary } from "./driver-stops-shared";

const POST_STATUSES = ["delivered_reported", "qty_disputed", "pending_settlement", "completed"];

/**
 * The whole driver experience for a per-parcel (`manifest: true`) job, rendered from the server's `actions[]` / `stops[]` / `stopsSummary`.
 * Statuses before hand-over (accepted, arrived) stay with the page's generic "next step" card. While the stops are worked the screen is the shipment
 * run sheet (`ShipmentsBoard`); with the platform's routing switch ON it also has the route review / approval, the route summary, re-ordering and the map.
 */
export function ManifestFlow({ job, offerId, onRefresh, onJob }: { job: any; offerId: string; onRefresh: () => unknown; onJob?: (job: any) => void }) {
  const { t } = useI18n();
  const [view, setView] = useRouteView();
  const has = (x: string) => (job.actions as string[]).includes(x);
  const stops = orderStops((job.stops ?? []) as Stop[]);
  const sum = job.stopsSummary as StopsSummary | null;
  const route = (job.route ?? null) as RouteInfo | null;
  const policy = policyOf(job);
  const showType = (job.policy as { b2bShipmentsEnabled?: unknown } | undefined)?.b2bShipmentsEnabled !== false;
  const refresh = () => { void onRefresh(); };
  // After a route-level step the screen is new (next stage): confirm briefly and bring it into view.
  const advanced = (k: string) => { toast.success(t(k)); window.scrollTo({ top: 0, behavior: "smooth" }); void onRefresh(); };
  // After a stop action the list stays where it is — only the data refreshes.
  const stopDone = (k: string) => { toast.success(t(k)); void onRefresh(); };

  if (job.status === "attendance_confirmed") {
    // E3: the driver scans the parcels onto the vehicle (the warehouse records nothing)
    if (has("scan_loading") || has("finish_loading")) return <LoadingScan job={job} offerId={offerId} stops={stops} canFinish={has("finish_loading")} onJob={onJob} onRefresh={onRefresh} />;
    if (has("ack_loading")) return <AckCard job={job} offerId={offerId} onDone={refresh} />;
    const approving = has("approve_route"); const working = has("work_stops"); const finishing = has("report_delivered") && !!sum;
    if (approving || working || finishing) {
      const routeUi = routingEnabledOf(job) || approving; // a job still waiting for approval keeps the route screens whatever the switch says
      const mapTab = routeUi && stops.length > 0 && !finishing;
      const showMap = mapTab && view === "map";
      const reorderable = !!route?.canReorder && movableStops(stops).length >= 2;
      const remaining = sum ? progressOf(sum).remaining : 0;
      return (
        <div className="space-y-4">
          {mapTab && <ViewTabs view={view} onChange={setView} />}
          {showMap && working && <ShipHeader counters={shipCounters(stops)} cashLeftCents={cashToCollect(stops)} cashCollectedCents={cashCollected(stops)} />}
          {showMap ? <RouteMapPanel stops={stops} route={route} offerId={offerId} policy={policy} onAdvanced={advanced} onJob={onJob} onRefresh={refresh} />
            : approving ? <RouteReview job={job} stops={stops} route={route} offerId={offerId} showType={showType} onAdvanced={advanced} onJob={onJob} onRefresh={refresh} />
            : (
              <>
                {finishing && sum && <FinishCard sum={sum} offerId={offerId} earningHidden={job.earningHidden === true} onAdvanced={advanced} />}
                {working && !stops.some((s) => s.status === "loaded") && <Notice tone="info">{t("dstop.syncing")}</Notice>}
                <ShipmentsBoard stops={stops} offerId={offerId} policy={policy} routing={routeUi} interactive={working} showType={showType} onStopDone={stopDone} onRefresh={refresh} />
                {working && routeUi && route && <RouteSummary route={route} stops={stops} offerId={offerId} approved onJob={onJob} onRefresh={refresh} />}
                {working && routeUi && <ReorderOff route={route} job={job} />}
                {working && routeUi && reorderable && <ReorderSection stops={stops} offerId={offerId} onJob={onJob} onRefresh={refresh} />}
                {working && has("end_route") && <EndRoute offerId={offerId} remaining={remaining} onAdvanced={advanced} />}
              </>
            )}
          {showMap && approving && <RouteReviewBar offerId={offerId} onAdvanced={advanced} />}
          {showMap && working && has("end_route") && <EndRoute offerId={offerId} remaining={remaining} onAdvanced={advanced} />}
        </div>
      );
    }
    // Only the warehouse-hand-over mode ever waits on the warehouse: in scan mode there is nothing to wait for.
    if (loadingOf(job).mode === "driver_scan") return <LoadingWaiting />;
    return <WaitingHandover disputed={job.loadedAckByDriver === false} />;
  }
  if (POST_STATUSES.includes(job.status) && sum && sum.total > 0) {
    return (
      <div className="space-y-4">
        <PostRoute job={job} sum={sum} />
        <ShipmentsBoard stops={stops} offerId={offerId} policy={policy} routing={routingEnabledOf(job)} interactive={false} showType={showType} onStopDone={stopDone} onRefresh={refresh} />
      </div>
    );
  }
  return null;
}
