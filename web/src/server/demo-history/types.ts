import type { HistoryOptions } from "./options";
import type { IdGen } from "./ids";
import type { Rng } from "./prng";
import type { Posting, Sink } from "./writer";
import type { Baseline } from "./load";
import type { SnapshotAcc } from "./acc";

/** Shapes shared by the generator's modules. Times are UTC milliseconds throughout (rows get `Date`s when they are written). */
export interface ActorRef { id: string; name: string; role: string }

export interface CityDef { key: string; ar: string; en: string; lat: number; lng: number; pickup: boolean; delivery: boolean }

export interface StaffSim extends ActorRef {
  email: string; staffRole: string | null; permissions: string[]; existing: boolean; createdAt: number; team: "admin" | "support" | "ops" | "finance" | "hr";
}

export interface Affiliation { from: number; to: number; officeId: string | null }

export interface DriverSim {
  idx: number; id: string; name: string; phone: string; city: string; lang: "ar" | "en"; existing: boolean;
  vehicleType: string; temperature: string | null; services: string[]; plate: string; nationalId: string; iban: string; bank: string;
  /** latent quality 0..1: drives rating, delivery success, cancellations, no-shows, lateness */
  q: number; acceptBase: number; respMedian: number;
  createdAt: number; verifiedAt: number | null; verification: "pending" | "verified" | "rejected" | "expired"; status: "active" | "suspended"; suspendedAt: number | null;
  activeFrom: number; activeTo: number;
  workDays: boolean[]; shiftStart: number; shiftLen: number; dayOn: number;
  affiliations: Affiliation[];
  jobs: Array<{ acc: number; end: number }>;
  cancels: number[]; strikeSuspensions: Array<{ from: number; to: number }>;
  ratingSum: number; ratingCount: number; jobsCompleted: number;
  /** what the profile row will say at the end (only events that have happened by the end of the window) */
  fin: { ratingSum: number; ratingCount: number; jobsCompleted: number };
  lastPing: { lat: number; lng: number; t: number } | null;
  lastOnlineState: boolean;
  /** history rows only: wallet account id (existing drivers: looked up) */
  walletId: string;
}

export interface OfficeSim {
  idx: number; id: string; name: string; contact: string; phone: string; city: string; existing: boolean; lang: "ar" | "en";
  createdAt: number; verifiedAt: number | null; verification: "pending" | "verified" | "rejected" | "info_requested" | "suspended"; status: "active" | "suspended";
  iban: string; bank: string; cr: string; tax: string; address: string; agreementAt: number | null;
  drivers: DriverSim[]; walletId: string;
}

export interface CompanySim {
  idx: number; id: string; name: string; phone: string; city: string; existing: boolean; lang: "ar" | "en";
  companyName: string; industry: string; address: string; cr: string; tax: string; contact: string;
  size: "enterprise" | "medium" | "small";
  lambda: number; createdAt: number; verifiedAt: number | null; verification: "pending" | "verified" | "rejected" | "info_requested" | "suspended"; status: "active" | "suspended"; suspendedAt: number | null;
  activeFrom: number; activeTo: number;
  warehouse: { lat: number; lng: number; area: string };
  ops: { requireArrivalConfirmation?: boolean; requireLoadingRecord?: boolean; requireDeliveryOtp?: boolean; requireSignature?: boolean } | null;
  webhookUrl: string | null; apiKey: boolean; creditLimitCents: number;
  codRate: number; b2bRate: number; parcelMedian: number; parcelSigma: number;
  vehicleMix: ReadonlyArray<readonly [string, number]>; deliveryMix: ReadonlyArray<readonly [string, number]>; contents: readonly string[];
  walletId: string;
  /** requests generated so far (reference for first-order stats) */
  requests: number;
  fin: { ratingSum: number; ratingCount: number };
}

export interface World {
  staff: StaffSim[]; admin: StaffSim;
  offices: OfficeSim[]; drivers: DriverSim[]; companies: CompanySim[];
  userCities: Map<string, string>;
  platformWalletId: string | null;
}

/** A support case the lifecycle wants raised (ticket or complaint) — turned into rows by support.ts. */
export interface TicketSeed { at: number; userId: string; role: "business" | "driver" | "office"; category: string; requestId?: string | null; offerId?: string | null; ref?: string; priority?: "normal" | "urgent"; subject?: string; body?: string; lang?: "en" | "ar" }
export interface ComplaintSeed {
  at: number; userId: string; role: "business" | "driver" | "office"; category: string; requestId?: string | null; offerId?: string | null; priority?: "normal" | "urgent";
  holdsSettlement?: boolean; description?: string; lang?: "en" | "ar"; /** the moment staff resolve it (forced: a held settlement is paid then) */ resolveAt?: number;
}
export interface NoteSeed { at: number; entity: string; entityId: string; authorId?: string; body?: string }

/** Cash-flow facts the money pass needs. */
export interface WithdrawalPlan { userId: string; accountId: string; role: "driver" | "office"; iban: string; bank: string; firstAt: number; everyDays: number; share: number }

export interface Counters { [k: string]: number }

export interface Ctx {
  opts: HistoryOptions; rng: Rng; ids: IdGen; sink: Sink;
  windowStart: number; windowEnd: number; asOf: number; days: number;
  cities: CityDef[]; vatPct: number; base: Baseline;
  w: World;
  postings: Posting[];
  ticketSeeds: TicketSeed[]; complaintSeeds: ComplaintSeed[]; noteSeeds: NoteSeed[];
  /** intervals for the metric snapshots (filled by the lifecycle, read by snapshots.ts) */
  iv: IntervalLog;
  acc: SnapshotAcc;
  platformWalletId: string;
  /** one row per finished job, so support cases (tickets, complaints, notes) can be attached to real work */
  jobRefs: JobRef[];
  /** automatic suspensions after repeated cancellations (cancellation policy) */
  suspensions: Array<{ driverId: string; from: number; to: number; cancellations: number }>;
  stats: Counters;
  /** `updated_at` of the pre-existing wallets before the history touched them (stored in the marker so a reset can restore it) */
  restoreWallets: Array<{ id: string; updatedAt: string }>;
  log: (msg: string) => void;
}

/** Intervals / points that snapshots.ts turns into hourly and daily numbers. */
export interface IntervalLog {
  cod: Array<{ at: number; cents: number }>;
  remit: Array<{ at: number; cents: number }>;
  settlementsPending: Array<{ from: number; to: number; cents: number }>;
  withdrawalsPending: Array<{ from: number; to: number; cents: number }>;
  tickets: Array<{ city: string; from: number; to: number }>;
  complaints: Array<{ city: string; from: number; to: number }>;
}
export interface JobRef { t: number; requestId: string; offerId: string; businessId: string; driverId: string; officeId: string | null; ref: string; failed: number; total: number; driverName: string; parcelId: string | null }
export const emptyIntervals = (): IntervalLog => ({ cod: [], remit: [], settlementsPending: [], withdrawalsPending: [], tickets: [], complaints: [] });
