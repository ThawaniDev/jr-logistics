/** Stable, machine-readable application errors. Never leak internals. */
export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT"
  | "INVALID_TRANSITION" | "INSUFFICIENT_FUNDS" | "NO_APPROVED_PRICE" | "SERVICE_DISABLED"
  | "OVERLAPPING_JOB" | "NOT_ELIGIBLE" | "SLOT_TAKEN" | "RATE_LIMITED" | "VERIFICATION_REQUIRED"
  | "TERMS_REQUIRED" | "DISPUTE_BLOCKS" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, CONFLICT: 409,
  INVALID_TRANSITION: 409, INSUFFICIENT_FUNDS: 402, NO_APPROVED_PRICE: 422, SERVICE_DISABLED: 422,
  OVERLAPPING_JOB: 409, NOT_ELIGIBLE: 403, SLOT_TAKEN: 409, RATE_LIMITED: 429, VERIFICATION_REQUIRED: 403,
  TERMS_REQUIRED: 422, DISPUTE_BLOCKS: 409, DEPENDENCY_UNAVAILABLE: 503, INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const err = (code: ErrorCode, message?: string, details?: Record<string, unknown>) =>
  new AppError(code, message, details);
