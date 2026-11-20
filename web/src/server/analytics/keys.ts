/** The names of the shared filter model. PURE (no imports): safe for client components. */
export const CHANNELS = ["web", "api", "mobile"] as const;
export const MULTI_KEYS = ["city", "service", "vehicle", "company", "office", "driver", "status", "channel"] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];
