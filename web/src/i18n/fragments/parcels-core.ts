import type { Dict } from "../core";
/**
 * Orders booked "details later" (parcels without recipient details) and best-route planning: server error, timeline event, notification and
 * route-warning strings shared by web and the mobile export. Screens live in parcels-business.ts / route-driver.ts / route-mobile.ts.
 * Route warnings arrive as `CODE` or `CODE:param` (e.g. `ROUTE_UNLOCATED_STOPS:3`); clients translate `route.warn.<CODE>` with `{n}` = the param.
 */
export const en: Dict = {
  "err.DETAILS_INCOMPLETE": "Some parcels still miss recipient details. Complete their name, phone and address before handing them to the driver.",
  "event.shipment_details_completed": "Parcel details completed", "event.details_reminder": "Reminder: parcels still need recipient details", "event.route_planned": "Best route planned",
  "notif.parcels_details_pending": "{ref}: {n} parcel(s) still need recipient details — complete them before the driver arrives",
  "route.provider.google_routes": "Google best route", "route.provider.local_heuristic": "Estimated route", "route.provider.mixed": "Google best route (part estimated)",
  "route.warn.ROUTING_PROVIDER_NOT_CONFIGURED": "Google routing is not set up on this platform — the order is an estimate from straight-line distances, not traffic-aware.",
  "route.warn.ROUTING_PROVIDER_FAILED": "Google routing did not answer for part of the route — that part is an estimate from straight-line distances.",
  "route.warn.ROUTE_UNLOCATED_STOPS": "{n} stop(s) have no location on the map and are placed last — check their addresses.",
  "route.warn.ROUTE_APPROXIMATE_LOCATIONS": "{n} stop(s) were located only approximately from their address.",
  "route.warn.ROUTE_NO_ORIGIN": "The starting point is unknown, so the route starts at the first stop.",
  "route.warn.ROUTE_GEOCODING_FAILED": "Some addresses could not be looked up right now — try re-optimising in a moment.",
};
export const ar: Dict = {
  "err.DETAILS_INCOMPLETE": "بعض الشحنات تنقصها بيانات المستلم. أكمل الاسم والجوال والعنوان قبل تسليمها للمندوب.",
  "event.shipment_details_completed": "اكتملت بيانات الشحنة", "event.details_reminder": "تذكير: شحنات ما زالت تنقصها بيانات المستلم", "event.route_planned": "تم تخطيط أفضل مسار",
  "notif.parcels_details_pending": "{ref}: {n} شحنة ما زالت تنقصها بيانات المستلم — أكملها قبل وصول المندوب",
  "route.provider.google_routes": "أفضل مسار من Google", "route.provider.local_heuristic": "مسار تقديري", "route.provider.mixed": "أفضل مسار من Google (جزء منه تقديري)",
  "route.warn.ROUTING_PROVIDER_NOT_CONFIGURED": "خدمة مسارات Google غير مفعّلة في المنصة — الترتيب تقديري بحسب المسافات المباشرة ولا يراعي الازدحام.",
  "route.warn.ROUTING_PROVIDER_FAILED": "لم تستجب خدمة Google لجزء من المسار — هذا الجزء مرتّب تقديرياً بحسب المسافات المباشرة.",
  "route.warn.ROUTE_UNLOCATED_STOPS": "{n} نقطة تسليم بلا موقع على الخريطة وضُعت في النهاية — راجع عناوينها.",
  "route.warn.ROUTE_APPROXIMATE_LOCATIONS": "تحدّد موقع {n} نقطة تسليم تقريبياً من عنوانها فقط.",
  "route.warn.ROUTE_NO_ORIGIN": "نقطة الانطلاق غير معروفة، لذلك يبدأ المسار من أول نقطة تسليم.",
  "route.warn.ROUTE_GEOCODING_FAILED": "تعذّر البحث عن بعض العناوين الآن — أعد تحسين المسار بعد قليل.",
};
export const ur: Dict = {
  "err.DETAILS_INCOMPLETE": "کچھ پارسلوں میں وصول کنندہ کی تفصیل نہیں ہے۔ ڈرائیور کے حوالے کرنے سے پہلے نام، فون اور پتہ مکمل کریں۔",
  "event.shipment_details_completed": "پارسل کی تفصیل مکمل ہو گئی", "event.details_reminder": "یاد دہانی: کچھ پارسلوں کی وصول کنندہ تفصیل باقی ہے", "event.route_planned": "بہترین راستہ طے ہو گیا",
  "notif.parcels_details_pending": "{ref}: {n} پارسل کی وصول کنندہ تفصیل باقی ہے — ڈرائیور کے آنے سے پہلے مکمل کریں",
  "route.provider.google_routes": "گوگل کا بہترین راستہ", "route.provider.local_heuristic": "اندازاً راستہ", "route.provider.mixed": "گوگل کا بہترین راستہ (کچھ حصہ اندازاً)",
  "route.warn.ROUTING_PROVIDER_NOT_CONFIGURED": "اس پلیٹ فارم پر گوگل روٹنگ فعال نہیں — ترتیب سیدھے فاصلے سے اندازاً ہے اور ٹریفک کو مدنظر نہیں رکھتی۔",
  "route.warn.ROUTING_PROVIDER_FAILED": "راستے کے ایک حصے کے لیے گوگل نے جواب نہیں دیا — وہ حصہ سیدھے فاصلے سے اندازاً ترتیب دیا گیا ہے۔",
  "route.warn.ROUTE_UNLOCATED_STOPS": "{n} اسٹاپ کا نقشے پر مقام نہیں ملا اور وہ آخر میں رکھے گئے — ان کے پتے دیکھ لیں۔",
  "route.warn.ROUTE_APPROXIMATE_LOCATIONS": "{n} اسٹاپ کا مقام پتے سے صرف اندازاً معلوم ہوا۔",
  "route.warn.ROUTE_NO_ORIGIN": "آغاز کا مقام معلوم نہیں، اس لیے راستہ پہلے اسٹاپ سے شروع ہوتا ہے۔",
  "route.warn.ROUTE_GEOCODING_FAILED": "کچھ پتے ابھی تلاش نہ ہو سکے — تھوڑی دیر بعد دوبارہ بہتر بنائیں۔",
};
