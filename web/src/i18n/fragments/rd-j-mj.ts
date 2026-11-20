import type { Dict } from "../core";

/**
 * Platform update J, worker MJ — the Flutter driver app: the shipments run sheet ("DRS", routing off, J2), the wallet of an office driver (J4) and the
 * wording that never mentions earnings for him. Every key starts with `drs.`. en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // card labels
  ["drs.l_name", "Name", "الاسم", "نام"],
  ["drs.l_address", "Address", "العنوان", "پتہ"],
  ["drs.l_cod", "COD amount", "مبلغ الدفع عند الاستلام", "کیش آن ڈیلیوری رقم"],
  ["drs.l_payment", "Payment mode", "طريقة الدفع", "ادائیگی کا طریقہ"],
  ["drs.l_pieces", "Pieces", "عدد القطع", "ٹکڑے"],
  ["drs.l_contents", "Contents", "المحتوى", "مواد"],
  ["drs.pay_cod", "COD", "عند الاستلام", "کیش آن ڈیلیوری"],
  ["drs.pay_prepaid", "Prepaid", "مدفوعة مسبقًا", "پیشگی ادا شدہ"],
  ["drs.next", "Next", "التالية", "اگلی"],
  // status chips
  ["drs.st_out", "Out for delivery", "في الطريق للتسليم", "ڈیلیوری کے لیے روانہ"],
  ["drs.st_delivered", "Delivered", "تم التسليم", "ڈیلیور ہو گئی"],
  ["drs.st_failed", "Not delivered", "لم تُسلَّم", "ڈیلیور نہیں ہوئی"],
  ["drs.st_returned", "Returned", "أُعيدت", "واپس کر دی گئی"],
  ["drs.st_missing", "Missing", "مفقودة", "لاپتہ"],
  ["drs.st_postponed", "Postponed", "مؤجَّلة", "مؤخر"],
  ["drs.st_pending", "Waiting for hand-over", "بانتظار التسليم", "حوالگی کا انتظار"],
  ["drs.st_cancelled", "Withdrawn", "مسحوبة", "واپس لی گئی"],
  // header, filters, search
  ["drs.hint_work", "Tap a shipment to arrive, deliver or report a problem. Any order works.", "اضغط على شحنة للوصول أو التسليم أو الإبلاغ عن مشكلة. يمكنك العمل بأي ترتيب.", "پہنچنے، ڈیلیور کرنے یا مسئلہ رپورٹ کرنے کے لیے کسی شپمنٹ پر ٹیپ کریں۔ کسی بھی ترتیب میں کام ہو سکتا ہے۔"],
  ["drs.hint_all_done", "Every shipment is done. Finish the route to complete the job.", "اكتملت جميع الشحنات. أنهِ المسار لإتمام المهمة.", "تمام شپمنٹس مکمل ہو گئیں۔ کام مکمل کرنے کے لیے روٹ مکمل کریں۔"],
  ["drs.progress", "{done} of {total} shipments done", "اكتملت {done} من {total} شحنة", "{total} میں سے {done} شپمنٹس مکمل"],
  ["drs.search_hint", "Search code, name, phone or address", "ابحث بالرمز أو الاسم أو الهاتف أو العنوان", "کوڈ، نام، فون یا پتہ تلاش کریں"],
  ["drs.empty_title", "No shipments match", "لا توجد شحنات مطابقة", "کوئی شپمنٹ نہیں ملی"],
  ["drs.empty_hint", "Try another filter or clear the search.", "جرّب فلترًا آخر أو امسح البحث.", "دوسرا فلٹر آزمائیں یا تلاش صاف کریں۔"],
  ["drs.clear_filters", "Show all shipments", "عرض كل الشحنات", "تمام شپمنٹس دکھائیں"],
  ["drs.all_shipments", "All shipments", "كل الشحنات", "تمام شپمنٹس"],
  // bottom bar, sheet, menu
  ["drs.next_shipment", "Next shipment", "الشحنة التالية", "اگلی شپمنٹ"],
  ["drs.left", "{n} left to deliver", "متبقٍ {n} للتسليم", "{n} ڈیلیور کرنے باقی"],
  ["drs.copy_address", "Copy address", "نسخ العنوان", "پتہ کاپی کریں"],
  ["drs.locked", "This shipment opens after you finish the current one.", "تُفتح هذه الشحنة بعد إنهاء الشحنة الحالية.", "یہ شپمنٹ موجودہ شپمنٹ مکمل کرنے کے بعد کھلے گی۔"],
  ["drs.more", "More", "المزيد", "مزید"],
  ["drs.job_details", "Job details", "تفاصيل المهمة", "کام کی تفصیلات"],
  // office drivers: no earnings wording (J4)
  ["drs.finish_ok_office", "Route finished. Your office handles the payment.", "تم إنهاء المسار. يتولى مكتبك الدفع.", "روٹ مکمل ہو گیا۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["drs.finish_paid_note_office", "Finishing confirms the delivery. Your office handles the payment.", "إنهاء المسار يؤكد التسليم. يتولى مكتبك الدفع.", "روٹ مکمل کرنے سے ڈیلیوری کی تصدیق ہو جاتی ہے۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["drs.completed_body_office", "Your delivery is confirmed. Your office handles the payment.", "تم تأكيد التسليم. يتولى مكتبك الدفع.", "آپ کی ڈیلیوری کی تصدیق ہو گئی۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["drs.hint_completed_office", "Job completed. Your office handles the payment.", "اكتملت المهمة. يتولى مكتبك الدفع.", "کام مکمل ہو گیا۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["drs.hint_settling_office", "Your delivery was recorded and is being finalised.", "تم تسجيل التسليم وجارٍ إنهاؤه.", "آپ کی ڈیلیوری درج ہو گئی ہے اور حتمی کی جا رہی ہے۔"],
  // wallet screen of an office driver
  ["drs.wallet_cash_title", "Wallet & cash", "المحفظة والنقد", "والٹ اور نقد"],
  ["drs.managed_title", "Your wallet is managed by your office", "محفظتك يديرها مكتبك", "آپ کا والٹ آپ کا دفتر سنبھالتا ہے"],
  ["drs.managed_body", "Your office receives the payment for your jobs and handles your payouts, so there is no balance or withdrawal here. The cash you collect on delivery is still shown below.", "يستلم مكتبك مقابل مهامك ويتولى دفعاتك، لذلك لا يوجد رصيد أو سحب هنا. يبقى النقد الذي تحصّله عند التسليم ظاهرًا أدناه.", "آپ کا دفتر آپ کے کاموں کی ادائیگی وصول کرتا اور آپ کی نکلوائی سنبھالتا ہے، اس لیے یہاں کوئی بیلنس یا رقم نکلوانے کی سہولت نہیں۔ ڈیلیوری پر وصول کیا گیا نقد نیچے دکھایا گیا ہے۔"],
  ["drs.managed_office", "Office: {office}", "المكتب: {office}", "دفتر: {office}"],
  ["drs.managed_hint", "Ask your office about your pay or payouts.", "اسأل مكتبك عن أجرك أو دفعاتك.", "اپنی ادائیگی یا نکلوائی کے بارے میں اپنے دفتر سے پوچھیں۔"],
  ["drs.managed_hint_office", "Ask {office} about your pay or payouts.", "اسأل {office} عن أجرك أو دفعاتك.", "اپنی ادائیگی یا نکلوائی کے بارے میں {office} سے پوچھیں۔"],
  ["drs.cash_section", "Cash on delivery", "النقد عند التسليم", "ڈیلیوری پر نقد رقم"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const DRS_ROWS = rows;
