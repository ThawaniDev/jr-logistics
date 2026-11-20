import type { Dict } from "../core";
/** Warehouse-system integrations: timeline event and notification strings shared by web and the mobile export. UI screens live in partners-business.ts / partners-admin.ts. */
export const en: Dict = {
  "nav.integrations": "Integrations",
  "event.partner_status": "Update from the warehouse system",
  "notif.partner_cancel_conflict": "{ref}: {provider} says parcel {code} was cancelled, but it could not be withdrawn automatically — please review it",
  "notif.partner_sync_failed": "Updates to {provider} (“{connection}”) are failing — open Integrations to fix the connection",
  "notif.partner_orders_new": "{n} new order(s) from {provider} (“{connection}”) are waiting in Incoming orders",
};
export const ar: Dict = {
  "nav.integrations": "الربط مع الأنظمة",
  "event.partner_status": "تحديث من نظام المستودع",
  "notif.partner_cancel_conflict": "{ref}: أفاد {provider} بإلغاء الشحنة {code} لكن تعذّر سحبها تلقائيًا — يرجى مراجعتها",
  "notif.partner_sync_failed": "تعذّر إرسال التحديثات إلى {provider} («{connection}») — افتح صفحة الربط لإصلاح الاتصال",
  "notif.partner_orders_new": "{n} طلب/طلبات جديدة من {provider} («{connection}») بانتظارك في الطلبات الواردة",
};
export const ur: Dict = {
  "nav.integrations": "سسٹم انٹیگریشنز",
  "event.partner_status": "گودام کے نظام کی طرف سے اپ ڈیٹ",
  "notif.partner_cancel_conflict": "{ref}: {provider} کے مطابق پارسل {code} منسوخ ہو گیا مگر خودکار طور پر واپس نہ لیا جا سکا — براہ کرم دیکھ لیں",
  "notif.partner_sync_failed": "{provider} («{connection}») کو اپ ڈیٹس نہیں جا رہیں — کنکشن ٹھیک کرنے کے لیے انٹیگریشنز کھولیں",
  "notif.partner_orders_new": "{provider} («{connection}») سے {n} نئے آرڈر آنے والے آرڈرز میں آپ کے منتظر ہیں",
};
