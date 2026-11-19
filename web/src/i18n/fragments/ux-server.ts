import type { Dict } from "../core";

/** Copy for the server-audit additions: new error codes and notifications (en / ar / ur). */
export const en: Dict = {
  "err.PAYLOAD_TOO_LARGE": "That upload or request is too large.",
  "err.CREDIT_LIMIT_EXCEEDED": "This would exceed your credit limit. Settle part of the outstanding balance first.",
  "notif.credit_limit_changed": "Your credit limit was updated",
};
export const ar: Dict = {
  "err.PAYLOAD_TOO_LARGE": "حجم الملف أو الطلب أكبر من المسموح.",
  "err.CREDIT_LIMIT_EXCEEDED": "هذه العملية ستتجاوز حدّك الائتماني. سدّد جزءاً من الرصيد المستحق أولاً.",
  "notif.credit_limit_changed": "تم تحديث حدّك الائتماني",
};
export const ur: Dict = {
  "err.PAYLOAD_TOO_LARGE": "یہ اپ لوڈ یا درخواست بہت بڑی ہے۔",
  "err.CREDIT_LIMIT_EXCEEDED": "اس سے آپ کی کریڈٹ حد سے تجاوز ہو جائے گا۔ پہلے بقایا رقم کا کچھ حصہ ادا کریں۔",
  "notif.credit_limit_changed": "آپ کی کریڈٹ حد اپ ڈیٹ کر دی گئی",
};
