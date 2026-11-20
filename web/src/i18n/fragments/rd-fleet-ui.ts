import type { Dict } from "../core";

/**
 * Fleet reports — the screens (decisions I7–I9, memory/FLEET_REPORTS.md): the Reports tab of an office and a driver, the courier-office portal page `/office/reports/performance`,
 * the "Performance tables" of Reports › Drivers / Courier offices, downloads and notes. Keys start with `fr.` (plus `nav.rep_performance`).
 * The table, KPI and export labels are in `rd-fleet.ts` / `rd-fleet-export.ts`. en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // entry points
  ["fr.tab_reports", "Reports", "التقارير", "رپورٹس"],
  ["nav.rep_performance", "Performance", "الأداء", "کارکردگی"],
  ["fr.portal_title", "Fleet performance", "أداء الأسطول", "فلیٹ کی کارکردگی"],
  ["fr.portal_sub", "Your drivers' work, day by day: punctuality, offers, time at the warehouse and on the road, money and failures — with downloads.", "عمل سائقيك يومًا بيوم: الالتزام بالمواعيد والعروض والوقت في المستودع وعلى الطريق والمال والإخفاقات — مع إمكانية التنزيل.", "آپ کے ڈرائیوروں کا کام روزانہ: وقت کی پابندی، آفرز، گودام اور راستے میں گزرا وقت، رقم اور ناکامیاں — ڈاؤن لوڈ کے ساتھ۔"],
  ["fr.no_access", "You do not have access to reports.", "ليس لديك صلاحية الوصول إلى التقارير.", "آپ کو رپورٹس تک رسائی حاصل نہیں۔"],
  // period
  ["fr.compare", "Compare with the previous period", "المقارنة بالفترة السابقة", "پچھلی مدت سے موازنہ"],
  ["fr.too_long", "Daily tables cover at most {n} days. Choose a shorter period.", "الجداول اليومية تغطي {n} يومًا كحد أقصى. اختر فترة أقصر.", "روزانہ جدولیں زیادہ سے زیادہ {n} دن کا احاطہ کرتی ہیں۔ مختصر مدت منتخب کریں۔"],
  // views
  ["fr.views", "Report views", "عروض التقرير", "رپورٹ کے منظر"],
  ["fr.view_daily", "Daily", "يومي", "روزانہ"],
  ["fr.view_drivers", "Drivers", "السائقون", "ڈرائیور"],
  ["fr.view_money", "Money", "المال", "رقم"],
  ["fr.view_money_daily", "Money by day", "المال حسب اليوم", "یومیہ رقم"],
  ["fr.view_jobs", "Jobs", "المهام", "کام"],
  ["fr.view_earnings", "Earnings", "الأرباح", "آمدنی"],
  ["fr.view_failures", "Failures", "الإخفاقات", "ناکامیاں"],
  ["fr.view_perf", "Performance", "الأداء", "کارکردگی"],
  ["fr.hint_daily", "One row per day of the period, in Riyadh time.", "صف لكل يوم من أيام الفترة، بتوقيت الرياض.", "مدت کے ہر دن کی ایک قطار، ریاض کے وقت کے مطابق۔"],
  ["fr.hint_drivers", "One row per driver: offers, activity, punctuality, time at the warehouse and on the road, distance, parcels and quality.", "صف لكل سائق: العروض والنشاط والالتزام بالمواعيد والوقت في المستودع وعلى الطريق والمسافة والطرود والجودة.", "ہر ڈرائیور کی ایک قطار: آفرز، سرگرمی، وقت کی پابندی، گودام اور راستے میں وقت، فاصلہ، پارسل اور معیار۔"],
  ["fr.hint_money", "Earnings, payments and cash held — one row per driver.", "الأرباح والمدفوعات والنقد المحتجز — صف لكل سائق.", "آمدنی، ادائیگیاں اور پاس موجود نقدی — ہر ڈرائیور کی ایک قطار۔"],
  ["fr.hint_money_daily", "Earnings, payments and cash collected — one row per day.", "الأرباح والمدفوعات والنقد المحصَّل — صف لكل يوم.", "آمدنی، ادائیگیاں اور وصول شدہ نقدی — ہر دن کی ایک قطار۔"],
  ["fr.hint_jobs", "One row per job: company, arrival and waiting times, parcels, distance, cash and earnings.", "صف لكل مهمة: الشركة وأوقات الوصول والانتظار والطرود والمسافة والنقد والأرباح.", "ہر کام کی ایک قطار: کمپنی، پہنچنے اور انتظار کا وقت، پارسل، فاصلہ، نقدی اور آمدنی۔"],
  ["fr.hint_earnings", "One row per settlement: amounts, status and payment date.", "صف لكل تسوية: المبالغ والحالة وتاريخ الدفع.", "ہر تصفیے کی ایک قطار: رقم، حالت اور ادائیگی کی تاریخ۔"],
  ["fr.hint_failures", "Why parcels failed or came back: each reason with its count, share and the drivers affected.", "أسباب فشل الطرود أو إرجاعها: كل سبب مع عدده ونسبته والسائقين المتأثرين.", "پارسل کیوں ناکام ہوئے یا واپس آئے: ہر وجہ، اس کی تعداد، حصہ اور متاثرہ ڈرائیور۔"],
  ["fr.hint_perf_drivers", "One row per driver that worked in the period.", "صف لكل سائق عمل خلال الفترة.", "مدت میں کام کرنے والے ہر ڈرائیور کی ایک قطار۔"],
  ["fr.hint_perf_offices", "One row per courier office, plus one row for independent drivers.", "صف لكل مكتب توصيل، إضافةً إلى صف للسائقين المستقلين.", "ہر کوریئر آفس کی ایک قطار، اور آزاد ڈرائیوروں کی ایک الگ قطار۔"],
  // downloads and notes
  ["fr.download", "Download", "تنزيل", "ڈاؤن لوڈ"],
  ["fr.dl_xlsx", "Excel (.xlsx)", "ملف Excel (‎.xlsx)", "Excel (‎.xlsx)"],
  ["fr.dl_xlsx_hint", "Formatted, with a notes sheet", "منسّق، مع ورقة ملاحظات", "فارمیٹ شدہ، نوٹس شیٹ کے ساتھ"],
  ["fr.dl_csv", "CSV (.csv)", "ملف CSV (‎.csv)", "CSV (‎.csv)"],
  ["fr.dl_csv_hint", "Plain values for other tools", "قيم خام لاستخدامها في أدوات أخرى", "دوسرے ٹولز کے لیے سادہ قدریں"],
  ["fr.export_needs_perm", "Exporting needs the export permission.", "التصدير يتطلب صلاحية التصدير.", "ایکسپورٹ کے لیے ایکسپورٹ کی اجازت درکار ہے۔"],
  ["fr.workbook", "Download workbook", "تنزيل ملف Excel الكامل", "مکمل ورک بک ڈاؤن لوڈ کریں"],
  ["fr.workbook_hint", "One Excel file with every table of this page (summary, daily, drivers, money, jobs, earnings, failures and notes) for the selected period.", "ملف Excel واحد يضم جداول هذه الصفحة كلها (الملخص واليومي والسائقون والمال والمهام والأرباح والإخفاقات والملاحظات) للفترة المحددة.", "ایک Excel فائل جس میں اس صفحے کے تمام جدول شامل ہیں (خلاصہ، روزانہ، ڈرائیور، رقم، کام، آمدنی، ناکامیاں اور نوٹس) منتخب مدت کے لیے۔"],
  ["fr.workbook_preparing", "Preparing…", "جارٍ التجهيز…", "تیار ہو رہا ہے…"],
  ["fr.notes_title", "How to read this", "كيف تقرأ هذا الجدول", "اسے کیسے پڑھیں"],
  ["fr.notes_error", "The notes could not be loaded.", "تعذّر تحميل الملاحظات.", "نوٹس لوڈ نہیں ہو سکے۔"],
  ["fr.notes_none", "No notes for this table.", "لا توجد ملاحظات لهذا الجدول.", "اس جدول کے لیے کوئی نوٹس نہیں۔"],
  // performance tables on the report pages
  ["fr.perf_title", "Performance tables", "جداول الأداء", "کارکردگی کے جدول"],
  ["fr.perf_sub_drivers", "Same filters as above, one table at a time: per driver, per day, money, jobs and failures. Every table downloads as Excel or CSV.", "المرشحات نفسها أعلاه، جدولًا بعد جدول: لكل سائق ولكل يوم والمال والمهام والإخفاقات. يمكن تنزيل كل جدول بصيغة Excel أو CSV.", "اوپر والے فلٹرز ہی، ایک وقت میں ایک جدول: ہر ڈرائیور، ہر دن، رقم، کام اور ناکامیاں۔ ہر جدول Excel یا CSV میں ڈاؤن لوڈ ہو سکتا ہے۔"],
  ["fr.perf_sub_offices", "Same filters as above, one table at a time: per office, per day, money, jobs, earnings and failures. Every table downloads as Excel or CSV.", "المرشحات نفسها أعلاه، جدولًا بعد جدول: لكل مكتب ولكل يوم والمال والمهام والأرباح والإخفاقات. يمكن تنزيل كل جدول بصيغة Excel أو CSV.", "اوپر والے فلٹرز ہی، ایک وقت میں ایک جدول: ہر دفتر، ہر دن، رقم، کام، آمدنی اور ناکامیاں۔ ہر جدول Excel یا CSV میں ڈاؤن لوڈ ہو سکتا ہے۔"],
  // KPI groups
  ["fr.grp_more", "More metrics", "مؤشرات إضافية", "مزید اشاریے"],
  ["fr.grp_fleet", "Fleet and activity", "الأسطول والنشاط", "فلیٹ اور سرگرمی"],
  ["fr.grp_work", "Work and results", "العمل والنتائج", "کام اور نتائج"],
  ["fr.grp_reliability", "Reliability", "الموثوقية", "قابلِ اعتماد ہونا"],
  ["fr.grp_punctuality", "Punctuality", "الالتزام بالمواعيد", "وقت کی پابندی"],
  ["fr.grp_offers", "Offers and response", "العروض والاستجابة", "آفرز اور جواب"],
  ["fr.grp_timing", "Time at the warehouse and on the road", "الوقت في المستودع وعلى الطريق", "گودام اور راستے میں گزرا وقت"],
  ["fr.grp_distance", "Distance", "المسافة", "فاصلہ"],
  ["fr.grp_efficiency", "Efficiency", "الكفاءة", "کارآمدی"],
  ["fr.grp_quality", "Quality and complaints", "الجودة والشكاوى", "معیار اور شکایات"],
  ["fr.grp_earnings", "Earnings and cash", "الأرباح والنقد", "آمدنی اور نقدی"],
  ["fr.grp_changes", "Fleet changes and agreement", "تغيّرات الأسطول والاتفاقية", "فلیٹ میں تبدیلیاں اور معاہدہ"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const FR_UI_ROWS = rows;
