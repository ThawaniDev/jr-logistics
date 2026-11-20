/** Thresholds and names shared by the portal reports' server code and screens. PURE and import-free, so client components can read them without pulling server modules into the bundle. */

/** A rate is only ranked or flagged when at least this many events stand behind it (parcels, due jobs, offers, ratings, jobs). */
export const MIN_VOLUME = { parcels: 10, due: 3, offers: 5, ratings: 3, jobs: 3 } as const;
/** Thresholds of the coaching flags (shown to the user next to the reason). */
export const FLAG_LIMITS = { success: 0.85, onTime: 0.7, noShow: 0.1, cancel: 0.2, rating: 3.5, acceptance: 0.5 } as const;
export const FLAGS = ["low_success", "late", "no_shows", "cancellations", "low_rating", "low_acceptance"] as const;
export type Flag = (typeof FLAGS)[number] | "idle";
/** The key of the chart series that sums every dimension value outside the top ones. */
export const OTHER_KEY = "__other";
