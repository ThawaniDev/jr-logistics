import type { Dict } from "../core";

/**
 * Excel export of reports (`server/export/*`): sheet names, the Notes sheet labels, the Summary headers and the generic "how to read this" lines. Every key starts with `fr.`
 * (`fr.sheet_*`, `fr.xl_*`); the fleet-report tables, KPIs and their own notes live in `rd-fleet.ts`. en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // sheet names (Excel limits a name to 31 characters)
  ["fr.sheet_summary", "Summary", "الملخص", "خلاصہ"],
  ["fr.sheet_daily", "Daily", "يومي", "روزانہ"],
  ["fr.sheet_drivers", "Drivers", "السائقون", "ڈرائیورز"],
  ["fr.sheet_daily_by_driver", "Daily by driver", "يومي لكل سائق", "ڈرائیور کے حساب سے روزانہ"],
  ["fr.sheet_money", "Money", "المالية", "مالیات"],
  ["fr.sheet_money_daily", "Money by day", "المالية يوميًا", "روزانہ مالیات"],
  ["fr.sheet_jobs", "Jobs", "المهام", "کام"],
  ["fr.sheet_earnings", "Earnings", "المستحقات", "کمائی"],
  ["fr.sheet_failures", "Failures", "حالات الإخفاق", "ناکامیاں"],
  ["fr.sheet_notes", "Notes", "ملاحظات", "نوٹس"],
  ["fr.sheet_data", "Data", "البيانات", "ڈیٹا"],
  // Notes sheet
  ["fr.xl_title", "JR Logistics · {name}", "جي آر للخدمات اللوجستية · {name}", "جے آر لاجسٹکس · {name}"],
  ["fr.xl_report", "Report", "التقرير", "رپورٹ"],
  ["fr.xl_table", "Table", "الجدول", "جدول"],
  ["fr.xl_entity_office", "Courier office", "مكتب التوصيل", "کوریئر آفس"],
  ["fr.xl_entity_driver", "Driver", "السائق", "ڈرائیور"],
  ["fr.xl_period", "Period", "الفترة", "مدت"],
  ["fr.xl_period_value", "{from} to {to} ({days} days)", "من {from} إلى {to} ({days} يومًا)", "{from} سے {to} تک ({days} دن)"],
  ["fr.xl_prev_period", "Compared with", "المقارنة مع", "موازنہ"],
  ["fr.xl_filters", "Filters", "المرشحات", "فلٹرز"],
  ["fr.xl_no_filters", "None (all data)", "بدون (كل البيانات)", "کوئی نہیں (تمام ڈیٹا)"],
  ["fr.xl_generated", "Generated at (Riyadh time)", "وقت الإنشاء (بتوقيت الرياض)", "تیار کرنے کا وقت (ریاض کا وقت)"],
  ["fr.xl_rows", "Rows exported", "عدد الصفوف المصدّرة", "برآمد شدہ قطاریں"],
  ["fr.xl_truncated", "Warning: the export stopped at {max} rows. Narrow the period or the filters to get the rest.", "تنبيه: توقّف التصدير عند {max} صف. ضيّق الفترة أو المرشحات للحصول على الباقي.", "انتباہ: برآمد {max} قطاروں پر رک گئی۔ باقی کے لیے مدت یا فلٹرز کم کریں۔"],
  ["fr.xl_sheet_truncated", "Sheet \"{sheet}\" stopped at {max} rows. Narrow the period or the filters to get the rest.", "توقّفت الورقة \"{sheet}\" عند {max} صف. ضيّق الفترة أو المرشحات للحصول على الباقي.", "شیٹ \"{sheet}\" {max} قطاروں پر رک گئی۔ باقی کے لیے مدت یا فلٹرز کم کریں۔"],
  ["fr.xl_howto", "How to read this", "كيف تقرأ هذا التقرير", "اسے کیسے پڑھیں"],
  ["fr.xl_sheets", "Sheets", "الأوراق", "شیٹس"],
  // Summary sheet headers
  ["fr.xl_kpi", "Indicator", "المؤشر", "اشاریہ"],
  ["fr.xl_current", "Current period", "الفترة الحالية", "موجودہ مدت"],
  ["fr.xl_previous", "Previous period", "الفترة السابقة", "پچھلی مدت"],
  ["fr.xl_change", "Change", "التغيّر", "تبدیلی"],
  ["fr.xl_change_pct", "Change %", "نسبة التغيّر", "تبدیلی %"],
  ["fr.xl_definition", "Definition", "التعريف", "تعریف"],
  ["fr.xl_note", "Note", "ملاحظة", "نوٹ"],
  // units appended to headers
  ["fr.xl_sar", "SAR", "ر.س", "ریال"],
  ["fr.xl_km", "km", "كم", "کلومیٹر"],
  // report names (the generic table export names the report it came from)
  ["fr.xl_report_overview", "Overview", "نظرة عامة", "جائزہ"],
  ["fr.xl_report_operations", "Operations", "العمليات", "آپریشنز"],
  ["fr.xl_report_geography", "Geography", "الجغرافيا", "جغرافیہ"],
  ["fr.xl_report_deliveries", "Deliveries", "التوصيلات", "ڈیلیوریز"],
  ["fr.xl_report_cod", "Cash on delivery", "الدفع عند الاستلام", "کیش آن ڈیلیوری"],
  ["fr.xl_report_finance", "Finance", "المالية", "مالیات"],
  ["fr.xl_report_companies", "Companies", "المنشآت", "کمپنیاں"],
  ["fr.xl_report_drivers", "Drivers", "السائقون", "ڈرائیورز"],
  ["fr.xl_report_offices", "Courier offices", "مكاتب التوصيل", "کوریئر آفسز"],
  ["fr.xl_report_growth", "Growth and onboarding", "النمو والانضمام", "نمو اور آن بورڈنگ"],
  ["fr.xl_report_support", "Support", "الدعم", "سپورٹ"],
  ["fr.xl_report_portal_office", "Courier office report", "تقرير مكتب التوصيل", "کوریئر آفس رپورٹ"],
  ["fr.xl_report_portal_business", "Company report", "تقرير المنشأة", "کمپنی رپورٹ"],
  // generic "how to read this" lines (the report-specific ones come from the fleet notes)
  ["fr.xl_note_tz", "Dates and times are Riyadh time (UTC+3). A day means a Riyadh calendar day.", "التواريخ والأوقات بتوقيت الرياض (UTC+3). اليوم يعني يومًا تقويميًا بتوقيت الرياض.", "تاریخیں اور اوقات ریاض کے وقت (UTC+3) کے مطابق ہیں۔ دن سے مراد ریاض کا کیلنڈر دن ہے۔"],
  ["fr.xl_note_money", "Money is in Saudi riyals (SAR), shown with two decimals. Column headers marked (SAR) are money.", "المبالغ بالريال السعودي (ر.س) بخانتين عشريتين. الأعمدة التي تحمل (ر.س) في عنوانها مبالغ مالية.", "رقوم سعودی ریال (SAR) میں دو اعشاریہ کے ساتھ ہیں۔ جن کالموں کے عنوان میں (ریال) لکھا ہے وہ رقوم ہیں۔"],
  ["fr.xl_note_empty", "An empty cell means there is nothing to measure (for example an average over no orders). It is not zero.", "الخلية الفارغة تعني عدم وجود ما يُقاس (مثل متوسط دون أي طلبات). وهي ليست صفرًا.", "خالی خانے کا مطلب ہے کہ ناپنے کے لیے کچھ نہیں (مثلاً بغیر آرڈرز کی اوسط)۔ یہ صفر نہیں ہے۔"],
  ["fr.xl_note_percent", "Percentages are shares (0% to 100%) of the group named in the column; a rate is always out of its own base.", "النسب المئوية هي حصص (من 0% إلى 100%) من المجموعة المذكورة في العمود، ولكل نسبة أساسها الخاص.", "فیصد اس گروپ کا حصہ ہیں جو کالم میں بتایا گیا ہے (0% سے 100%)؛ ہر شرح کی اپنی بنیاد ہوتی ہے۔"],
  ["fr.xl_note_duration", "Durations are shown as hours:minutes:seconds (a value over 24 hours keeps counting hours).", "المدد معروضة بصيغة ساعات:دقائق:ثوانٍ (وما زاد على 24 ساعة يستمر عدّ الساعات).", "دورانیے گھنٹے:منٹ:سیکنڈ میں دکھائے گئے ہیں (24 گھنٹے سے زیادہ پر بھی گھنٹے گنے جاتے ہیں)۔"],
  ["fr.xl_note_km", "Distances are in kilometres (km), shown with one decimal.", "المسافات بالكيلومتر (كم) بخانة عشرية واحدة.", "فاصلے کلومیٹر میں ایک اعشاریہ کے ساتھ ہیں۔"],
  ["fr.xl_note_text", "Text that starts with = + - or @ is saved with a leading apostrophe so a spreadsheet never runs it as a formula.", "النص الذي يبدأ بـ = أو + أو - أو @ يُحفظ مسبوقًا بفاصلة عليا حتى لا يُنفَّذ كمعادلة.", "جو متن = + - یا @ سے شروع ہو اس کے آگے اپاسٹروف لگا کر محفوظ کیا جاتا ہے تاکہ اسپریڈشیٹ اسے فارمولا نہ سمجھے۔"],
  ["fr.xl_note_hidden_money", "Money columns and money sheets are not included because your account has no finance access.", "أعمدة وأوراق المالية غير مضمّنة لأن حسابك لا يملك صلاحية المالية.", "مالی کالم اور شیٹس شامل نہیں کیونکہ آپ کے اکاؤنٹ کو مالیاتی رسائی حاصل نہیں۔"],
  ["fr.xl_note_summary", "Summary: Change = current period minus previous period. Percentage indicators change in percentage points; duration indicators change in seconds.", "الملخص: التغيّر = الفترة الحالية ناقص السابقة. تتغيّر المؤشرات المئوية بالنقاط المئوية، وتتغيّر مؤشرات المدة بالثواني.", "خلاصہ: تبدیلی = موجودہ مدت منفی پچھلی مدت۔ فیصدی اشاریے فیصدی پوائنٹس میں اور دورانیے سیکنڈ میں بدلتے ہیں۔"],
  ["fr.xl_note_filters", "Only the data matching the filters above is included. Other filters are not applied.", "تشمل البيانات المطابقة للمرشحات أعلاه فقط. لا تُطبَّق مرشحات أخرى.", "صرف اوپر دیے گئے فلٹرز سے مطابقت رکھنے والا ڈیٹا شامل ہے۔ دوسرے فلٹرز لاگو نہیں ہوتے۔"],
  ["fr.xl_omitted_daily_by_driver", "The \"Daily by driver\" sheet was left out: {drivers} drivers x {days} days = {rows} rows is above the limit ({max} rows, {maxDrivers} drivers). Choose a shorter period or a smaller fleet.", "حُذفت ورقة \"يومي لكل سائق\": {drivers} سائقًا × {days} يومًا = {rows} صف وهو يتجاوز الحد ({max} صف، {maxDrivers} سائقًا). اختر فترة أقصر أو أسطولًا أصغر.", "شیٹ \"ڈرائیور کے حساب سے روزانہ\" شامل نہیں: {drivers} ڈرائیور × {days} دن = {rows} قطاریں حد ({max} قطاریں، {maxDrivers} ڈرائیور) سے زیادہ ہیں۔ مختصر مدت یا چھوٹا بیڑا منتخب کریں۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const FLEET_EXPORT_ROWS = rows;
