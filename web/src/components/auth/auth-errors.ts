import { ApiError } from "@/lib/api";
import { friendlyErr } from "@/components/features/driver-action";

type TFn = (k: string, v?: Record<string, string | number>) => string;

/** Sign-in errors, said kindly and specifically: what happened and what to do next. */
export function loginErr(e: unknown, t: TFn): string {
  if (e instanceof ApiError) {
    if (e.code === "UNAUTHENTICATED") return t("ja.err_invalid");
    if (e.code === "RATE_LIMITED") return t(/locked/i.test(e.message) ? "ja.err_locked" : "ux.d_auth_rate");
    if (e.code === "FORBIDDEN") return t("ux.d_auth_suspended");
  }
  return friendlyErr(e, t);
}

/** Server field problems (register / create account / change password) → a sentence in the user's language, keyed by field. */
export function fieldProblems(e: unknown, t: TFn): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const d = e.details as Record<string, unknown>;
  const field = typeof d.field === "string" ? d.field : null;
  if (e.code === "CONFLICT" && (field === "username" || field === "phone" || field === "email")) return { [field]: t(`ja.err_${field}_taken`) };
  if (e.code === "VALIDATION") {
    if (field === "username") return { username: d.reason === "reserved" ? t("ja.un_reserved") : t("ja.un_invalid") };
    if (field === "password" || field === "newPassword") return { [field]: t(e.message === "PASSWORD_WEAK" ? "ja.err_pw_weak" : e.message === "SAME_PASSWORD" ? "ja.cp_same" : "ja.err_pw_short") };
    if (field === "phone") return { phone: t("ja.err_phone_invalid") };
  }
  return {};
}
