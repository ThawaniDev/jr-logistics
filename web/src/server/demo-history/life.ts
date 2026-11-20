import { parcelRowsFromJobEvent } from "@/server/shipment-events";
import { milestonesFor } from "@/server/data-capture";
import type { Insert } from "./writer";
import { Tl } from "./timeline";
import type { ActorRef, CompanySim, Ctx, DriverSim } from "./types";
import type { ParcelSpec, RequestPlan } from "./plan";
import type { Rng } from "./prng";

/**
 * One request, being simulated. It collects timed patches (request / offers / parcels), timed events and timed side effects (`fx`: ledger postings,
 * settlements, ratings …) — all in the order the real code would have produced them — and `emit()` turns whatever happened by `asOf` into rows.
 */
export type ReqRow = Insert<"requests">;
export type OfferRow = Insert<"offers">;
export type ShipRow = Insert<"shipments">;
export type SettlementRow = Insert<"settlements">;

export interface Evt { t: number; type: string; actor: ActorRef | null; offerId?: string | null; old?: string | null; neu?: string | null; payload?: Record<string, unknown> | null; late?: boolean }
export interface PEvt { t: number; shipmentId: string; offerId?: string | null; type: string; actor: ActorRef | null; payload?: Record<string, unknown> | null }
export interface Notif { t: number; userId: string; type: string; data: Record<string, unknown> }

export interface JobPlan {
  fate: "ok" | "cancel" | "noshow" | "ops"; tFate: number;
  arrive: number; attend: number; loadAt: number; ack: number; planAt: number; routeAt: number; loadedCount: number; late: boolean; autoAttend: boolean; scanMode: boolean;
}

export interface Parcel {
  id: string; spec: ParcelSpec; tl: Tl<ShipRow>; offer: Offer | null;
  /** moments used by the snapshot intervals: handed over, delivered / failed, withdrawn */
  t: { loaded: number | null; resolved: number | null; gone: number | null };
  notified: boolean;
}
export interface Offer {
  id: string; driver: DriverSim; tl: Tl<OfferRow>; createdAt: number; source: string; replacement: boolean; replacesId: string | null;
  parcels: Parcel[]; jobPlan: JobPlan | null; dead: boolean; acceptedAt: number | null; completedAt: number | null; tDone: number | null;
  officeId: string | null; delivered: number; failedCount: number; codCollected: number; settlementId: string | null; held: boolean; endedEarly: boolean; paidAt: number | null;
  /** the driver's busy interval for this job (closed when the job ends) */
  job: { acc: number; end: number } | null;
}

export class Life {
  readonly tl: Tl<ReqRow>;
  readonly offers: Offer[] = [];
  readonly parcels: Parcel[] = [];
  readonly events: Evt[] = [];
  readonly pevents: PEvt[] = [];
  readonly notifs: Notif[] = [];
  readonly settlements: Array<{ tl: Tl<SettlementRow>; t: number; paidAt: number | null }> = [];
  readonly fx: Array<{ t: number; i: number; run: () => void }> = [];
  readonly biz: ActorRef;
  /** Everyone offered (any wave), so a driver is never offered the same order twice. */
  readonly offered = new Set<string>();
  cancelled: { at: number; by: "business" | "staff" } | null = null;
  constructor(readonly ctx: Ctx, readonly rng: Rng, readonly plan: RequestPlan, base: ReqRow) {
    this.tl = new Tl<ReqRow>(base);
    this.biz = { id: plan.company.id, name: plan.company.name, role: "business" };
  }
  get company(): CompanySim { return this.plan.company; }
  ev(t: number, type: string, actor: ActorRef | null, o: { offer?: Offer | null; old?: string | null; neu?: string | null; payload?: Record<string, unknown> | null } = {}) {
    this.events.push({ t, type, actor, offerId: o.offer?.id ?? null, old: o.old ?? null, neu: o.neu ?? null, payload: o.payload ?? null });
  }
  pev(t: number, p: Parcel, type: string, actor: ActorRef | null, offer: Offer | null, payload?: Record<string, unknown>) {
    this.pevents.push({ t, shipmentId: p.id, offerId: offer?.id ?? null, type, actor, payload: payload ?? null });
  }
  notify(t: number, userId: string, type: string, data: Record<string, unknown> = {}) { this.notifs.push({ t, userId, type, data }); }
  on(t: number, run: () => void) { this.fx.push({ t, i: this.fx.length, run }); }
  driverActor(d: DriverSim): ActorRef { return { id: d.id, name: d.name, role: "driver" }; }
  /** Parcels derived mirror rows (otp_verified / delivered / cod_collected …) from the job events that carry a shipmentId. */
  mirrored(e: Evt): PEvt[] {
    const rows = parcelRowsFromJobEvent({ requestId: this.plan.id, offerId: e.offerId, actor: e.actor, type: e.type, payload: e.payload ?? null });
    return rows.map((r, k) => ({ t: e.t + k, shipmentId: r.shipmentId, offerId: r.offerId ?? null, type: r.type, actor: r.actor ?? null, payload: r.payload ?? null }));
  }
  /** milestones (first offer / accepted / filled / started) and last activity, exactly as `touchRequest` derives them. */
  milestones(asOf: number) {
    const out: { firstOffer: number | null; firstAccepted: number | null; filled: number | null; started: number | null; last: number | null } = { firstOffer: null, firstAccepted: null, filled: null, started: null, last: null };
    for (const e of this.events.slice().sort((a, b) => a.t - b.t)) {
      if (e.t > asOf) break;
      out.last = e.t;
      for (const m of milestonesFor(e.type, e.payload ?? null)) {
        const k = m === "first_offer" ? "firstOffer" : m === "first_accepted" ? "firstAccepted" : m;
        if (out[k as keyof typeof out] == null) (out as Record<string, number | null>)[k] = e.t;
      }
    }
    return out;
  }
}
