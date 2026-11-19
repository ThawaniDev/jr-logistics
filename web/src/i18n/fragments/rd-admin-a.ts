import type { Dict } from "../core";
/** UI redesign — Admin dashboard, operations, requests, map, cancellations, reports. Every key starts with `rda.`; add en, ar and ur together. */
export const en: Dict = {
  // shared (period filter, refresh, KPI rows)
  "rda.settlements_hold": "Settlements on hold", "rda.open_ops": "Open operations", "rda.todays_jobs": "Today's jobs", "rda.not_arrived": "Not arrived yet", "rda.unfilled_label": "Unfilled, starting soon", "rda.parcel_one": "1 parcel",
  "rda.period": "Period", "rda.period_all": "All time", "rda.period_today": "Today", "rda.period_7d": "Last 7 days", "rda.period_30d": "Last 30 days", "rda.period_month": "This month",
  "rda.updated_at": "Updated {time}", "rda.refresh": "Refresh", "rda.at_a_glance": "At a glance", "rda.all_cities": "All cities", "rda.details": "Request details",
  // dashboard
  "rda.open_queue": "Open the queue", "rda.alert_more": "+{n} more", "rda.requests_total": "{n} requests in total", "rda.breakdown_empty": "No requests yet", "rda.quick_actions": "Quick actions",
  "rda.live_hint": "{n} still looking for drivers", "rda.drivers_online": "Drivers online", "rda.drivers_online_hint": "{a} available · {j} on a job", "rda.drivers_registered": "Registered drivers",
  "rda.alerts_critical": "Critical alerts", "rda.alerts_hint": "{w} warnings · {i} notices", "rda.all_accounts": "All accounts", "rda.awaiting_verification": "{n} awaiting verification",
  "rda.paid_hint": "On paid settlements", "rda.cod_outstanding": "COD outstanding", "rda.cod_outstanding_hint": "Collected by drivers, not yet handed to warehouses",
  // operations
  "rda.expires_on": "expires {date}", "rda.alert_count": "{n} waiting", "rda.severity": "Severity", "rda.alert": "Alert", "rda.next_step": "Next step", "rda.alerts_sub": "Everything that needs a decision, most urgent first.",
  "rda.all_clear_hint": "New alerts appear here automatically.", "rda.cities_empty_hint": "No request has started in the last day.", "rda.today": "Today", "rda.today_hint": "Jobs starting today (Riyadh time)",
  // requests
  "rda.req_sub": "Every delivery and vehicle request on the platform. Open one to assign drivers, follow its parcels or cancel it.", "rda.in_progress_hint": "Drivers on the road",
  "rda.unfilled_hint": "Open slots, starting soon", "rda.late_hint": "Accepted but not on site", "rda.req_empty": "Requests appear here as soon as businesses publish them.",
  "rda.req_empty_filtered": "No request matches these filters. Widen the dates or clear the filters.", "rda.unit_price": "Unit price", "rda.drivers_sub": "{filled} of {qty} slots filled",
  "rda.cancel_note_staff": "The business's reserved funds are refunded to its wallet in full, and drivers who accepted are told.", "rda.timeline_count": "{n} events",
  // map
  "rda.map_locate": "Show {name} on the map", "rda.map_none_hint": "Drivers appear here while they are available or on a job and share their location.", "rda.map_shown": "{n} of {total} shown",
  "rda.cities_covered": "Cities covered", "rda.sharing_hint": "Sharing their location now", "rda.available_hint": "Ready for new jobs", "rda.on_job_hint": "Working a job right now", "rda.search_driver": "Search drivers by name",
  // cancellations
  "rda.cx_events": "Events", "rda.cx_in_range": "In the selected dates", "rda.cx_requests": "Requests cancelled", "rda.cx_drivers": "By drivers", "rda.cx_offer_withdrawn": "Offer withdrawn", "rda.cx_ops": "Replaced by operations",
  "rda.cx_scope_period": "In this period", "rda.on_this_page": "On this page", "rda.cx_page_filter_note": "Only the matching events of this page are shown; go to the next page to see more.",
  "rda.cx_empty": "No cancellations, no-shows or replacements have been recorded.", "rda.cx_empty_filtered": "Nothing matches these filters. Try another period or party.",
  // reports
  "rda.reports_sub": "Choose a report and a period. The table is a preview; the CSV export covers the whole period.", "rda.report_columns": "{n} columns", "rda.report_rows": "Rows",
  "rda.reports_empty": "No rows in this period. Try wider dates.",
};
export const ar: Dict = {
  "rda.settlements_hold": "تسويات معلّقة", "rda.open_ops": "فتح العمليات", "rda.todays_jobs": "مهام اليوم", "rda.not_arrived": "لم يصلوا بعد", "rda.unfilled_label": "شاغرة وتبدأ قريبًا", "rda.parcel_one": "طرد واحد",
  "rda.period": "الفترة", "rda.period_all": "كل الفترات", "rda.period_today": "اليوم", "rda.period_7d": "آخر 7 أيام", "rda.period_30d": "آخر 30 يومًا", "rda.period_month": "هذا الشهر",
  "rda.updated_at": "آخر تحديث {time}", "rda.refresh": "تحديث", "rda.at_a_glance": "نظرة سريعة", "rda.all_cities": "كل المدن", "rda.details": "تفاصيل الطلب",
  "rda.open_queue": "فتح القائمة", "rda.alert_more": "+{n} أخرى", "rda.requests_total": "{n} طلبًا في المجموع", "rda.breakdown_empty": "لا توجد طلبات بعد", "rda.quick_actions": "إجراءات سريعة",
  "rda.live_hint": "{n} ما زالت تبحث عن سائقين", "rda.drivers_online": "السائقون المتصلون", "rda.drivers_online_hint": "{a} متاح · {j} في مهمة", "rda.drivers_registered": "السائقون المسجلون",
  "rda.alerts_critical": "تنبيهات حرجة", "rda.alerts_hint": "{w} تحذيرات · {i} ملاحظات", "rda.all_accounts": "كل الحسابات", "rda.awaiting_verification": "{n} بانتظار التحقق",
  "rda.paid_hint": "من التسويات المدفوعة", "rda.cod_outstanding": "مستحقات COD", "rda.cod_outstanding_hint": "حصّلها السائقون ولم تُسلَّم للمستودعات بعد",
  "rda.expires_on": "تنتهي في {date}", "rda.alert_count": "{n} بانتظار المراجعة", "rda.severity": "الخطورة", "rda.alert": "التنبيه", "rda.next_step": "الإجراء التالي", "rda.alerts_sub": "كل ما يحتاج إلى قرار، الأكثر إلحاحًا أولًا.",
  "rda.all_clear_hint": "تظهر التنبيهات الجديدة هنا تلقائيًا.", "rda.cities_empty_hint": "لم يبدأ أي طلب خلال آخر يوم.", "rda.today": "اليوم", "rda.today_hint": "مهام تبدأ اليوم (بتوقيت الرياض)",
  "rda.req_sub": "كل طلبات التوصيل والمركبات على المنصة. افتح أي طلب لتعيين السائقين أو متابعة طرود الطلب أو إلغائه.", "rda.in_progress_hint": "سائقون على الطريق",
  "rda.unfilled_hint": "مقاعد شاغرة وتبدأ قريبًا", "rda.late_hint": "قبلوا الطلب ولم يصلوا إلى الموقع", "rda.req_empty": "تظهر الطلبات هنا بمجرد أن تنشرها الشركات.",
  "rda.req_empty_filtered": "لا يوجد طلب يطابق هذه المرشحات. وسّع التواريخ أو امسح المرشحات.", "rda.unit_price": "سعر الوحدة", "rda.drivers_sub": "تم شغل {filled} من {qty} مقاعد",
  "rda.cancel_note_staff": "يُردّ المبلغ المحجوز للشركة إلى محفظتها كاملًا، ويُبلَّغ السائقون الذين قبلوا الطلب.", "rda.timeline_count": "{n} أحداث",
  "rda.map_locate": "إظهار {name} على الخريطة", "rda.map_none_hint": "يظهر السائقون هنا أثناء توفرهم أو انشغالهم بمهمة ومشاركتهم لموقعهم.", "rda.map_shown": "المعروض {n} من {total}",
  "rda.cities_covered": "المدن المغطاة", "rda.sharing_hint": "يشاركون موقعهم الآن", "rda.available_hint": "جاهزون لمهام جديدة", "rda.on_job_hint": "يعملون على مهمة الآن", "rda.search_driver": "ابحث عن سائق بالاسم",
  "rda.cx_events": "الأحداث", "rda.cx_in_range": "ضمن التواريخ المحددة", "rda.cx_requests": "طلبات ملغاة", "rda.cx_drivers": "من السائقين", "rda.cx_offer_withdrawn": "عرض مسحوب", "rda.cx_ops": "استبدال من العمليات",
  "rda.cx_scope_period": "في هذه الفترة", "rda.on_this_page": "في هذه الصفحة", "rda.cx_page_filter_note": "تظهر الأحداث المطابقة في هذه الصفحة فقط؛ انتقل إلى الصفحة التالية لرؤية المزيد.",
  "rda.cx_empty": "لم تُسجَّل أي إلغاءات أو حالات عدم حضور أو استبدالات.", "rda.cx_empty_filtered": "لا شيء يطابق هذه المرشحات. جرّب فترة أو طرفًا آخر.",
  "rda.reports_sub": "اختر تقريرًا وفترة. يعرض الجدول معاينة، بينما يشمل ملف CSV الفترة كاملة.", "rda.report_columns": "{n} أعمدة", "rda.report_rows": "الصفوف",
  "rda.reports_empty": "لا توجد صفوف في هذه الفترة. جرّب تواريخ أوسع.",
};
export const ur: Dict = {
  "rda.settlements_hold": "رکی ہوئی تصفیے", "rda.open_ops": "آپریشنز کھولیں", "rda.todays_jobs": "آج کے کام", "rda.not_arrived": "ابھی نہیں پہنچے", "rda.unfilled_label": "خالی، جلد شروع", "rda.parcel_one": "1 پارسل",
  "rda.period": "مدت", "rda.period_all": "تمام وقت", "rda.period_today": "آج", "rda.period_7d": "پچھلے 7 دن", "rda.period_30d": "پچھلے 30 دن", "rda.period_month": "یہ مہینہ",
  "rda.updated_at": "اپ ڈیٹ {time}", "rda.refresh": "تازہ کریں", "rda.at_a_glance": "ایک نظر میں", "rda.all_cities": "تمام شہر", "rda.details": "درخواست کی تفصیل",
  "rda.open_queue": "قطار کھولیں", "rda.alert_more": "+{n} مزید", "rda.requests_total": "کل {n} درخواستیں", "rda.breakdown_empty": "ابھی کوئی درخواست نہیں", "rda.quick_actions": "فوری اقدامات",
  "rda.live_hint": "{n} ابھی ڈرائیوروں کی تلاش میں", "rda.drivers_online": "آن لائن ڈرائیور", "rda.drivers_online_hint": "{a} دستیاب · {j} کام پر", "rda.drivers_registered": "رجسٹرڈ ڈرائیور",
  "rda.alerts_critical": "فوری الرٹس", "rda.alerts_hint": "{w} انتباہات · {i} اطلاعات", "rda.all_accounts": "تمام اکاؤنٹس", "rda.awaiting_verification": "{n} تصدیق کے منتظر",
  "rda.paid_hint": "ادا شدہ تصفیوں پر", "rda.cod_outstanding": "COD واجب الادا", "rda.cod_outstanding_hint": "ڈرائیوروں نے وصول کیا، گودام کو ابھی نہیں دیا",
  "rda.expires_on": "{date} کو ختم ہو رہی ہے", "rda.alert_count": "{n} منتظر", "rda.severity": "شدت", "rda.alert": "الرٹ", "rda.next_step": "اگلا قدم", "rda.alerts_sub": "ہر وہ چیز جس پر فیصلہ درکار ہے، سب سے زیادہ فوری پہلے۔",
  "rda.all_clear_hint": "نئے الرٹس یہاں خود بخود ظاہر ہوں گے۔", "rda.cities_empty_hint": "پچھلے ایک دن میں کوئی درخواست شروع نہیں ہوئی۔", "rda.today": "آج", "rda.today_hint": "آج شروع ہونے والے کام (ریاض کے وقت کے مطابق)",
  "rda.req_sub": "پلیٹ فارم کی تمام ڈیلیوری اور گاڑی کی درخواستیں۔ ڈرائیور مقرر کرنے، پارسل دیکھنے یا منسوخ کرنے کے لیے کوئی درخواست کھولیں۔", "rda.in_progress_hint": "ڈرائیور راستے میں",
  "rda.unfilled_hint": "خالی نشستیں، جلد شروع", "rda.late_hint": "قبول کیا مگر موقع پر نہیں پہنچے", "rda.req_empty": "کمپنیوں کے شائع کرتے ہی درخواستیں یہاں نظر آئیں گی۔",
  "rda.req_empty_filtered": "ان فلٹرز سے کوئی درخواست نہیں ملی۔ تاریخیں بڑھائیں یا فلٹر صاف کریں۔", "rda.unit_price": "فی یونٹ قیمت", "rda.drivers_sub": "{qty} میں سے {filled} نشستیں پُر",
  "rda.cancel_note_staff": "کمپنی کی محفوظ کی گئی رقم اس کے والیٹ میں مکمل واپس کر دی جائے گی اور قبول کرنے والے ڈرائیوروں کو اطلاع دی جائے گی۔", "rda.timeline_count": "{n} واقعات",
  "rda.map_locate": "{name} کو نقشے پر دکھائیں", "rda.map_none_hint": "ڈرائیور اس وقت یہاں نظر آتے ہیں جب وہ دستیاب ہوں یا کسی کام پر ہوں اور اپنا مقام شیئر کریں۔", "rda.map_shown": "{total} میں سے {n} دکھائے گئے",
  "rda.cities_covered": "شامل شہر", "rda.sharing_hint": "ابھی مقام شیئر کر رہے ہیں", "rda.available_hint": "نئے کام کے لیے تیار", "rda.on_job_hint": "ابھی کسی کام پر", "rda.search_driver": "نام سے ڈرائیور تلاش کریں",
  "rda.cx_events": "واقعات", "rda.cx_in_range": "منتخب تاریخوں میں", "rda.cx_requests": "منسوخ شدہ درخواستیں", "rda.cx_drivers": "ڈرائیوروں کی طرف سے", "rda.cx_offer_withdrawn": "پیشکش واپس لی گئی", "rda.cx_ops": "آپریشنز کی تبدیلی",
  "rda.cx_scope_period": "اس مدت میں", "rda.on_this_page": "اس صفحے پر", "rda.cx_page_filter_note": "صرف اس صفحے کے مماثل واقعات دکھائے جا رہے ہیں؛ مزید دیکھنے کے لیے اگلے صفحے پر جائیں۔",
  "rda.cx_empty": "کوئی منسوخی، غیر حاضری یا تبدیلی درج نہیں ہوئی۔", "rda.cx_empty_filtered": "ان فلٹرز سے کچھ نہیں ملا۔ کوئی اور مدت یا فریق آزمائیں۔",
  "rda.reports_sub": "رپورٹ اور مدت منتخب کریں۔ جدول پیش نظارہ ہے، CSV پوری مدت کو شامل کرتی ہے۔", "rda.report_columns": "{n} کالم", "rda.report_rows": "قطاریں",
  "rda.reports_empty": "اس مدت میں کوئی قطار نہیں۔ وسیع تاریخیں آزمائیں۔",
};
