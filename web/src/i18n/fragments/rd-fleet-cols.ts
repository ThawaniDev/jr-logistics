/** Fleet reports: column labels (`fr.col_<key>`), keyed like the metric registry of `server/analytics/fleet-metrics.ts`. Rows are [key, en, ar, ur]. */
export type FleetRow = [key: string, en: string, ar: string, ur: string];
const L = (k: string, en: string, ar: string, ur: string): FleetRow => [`fr.col_${k}`, en, ar, ur];

export const COL_ROWS: FleetRow[] = [
  // people and entities
  L("date", "Date", "التاريخ", "تاریخ"), L("driver", "Driver", "السائق", "ڈرائیور"), L("office", "Office", "المكتب", "آفس"), L("vehicle", "Vehicle", "المركبة", "گاڑی"), L("city", "City", "المدينة", "شہر"),
  L("agreement", "Agreement", "الاتفاقية", "معاہدہ"), L("verification", "Verification", "التوثيق", "تصدیق"),
  L("registered", "New drivers", "سائقون جدد", "نئے ڈرائیور"), L("online_drivers", "Drivers online", "السائقون المتصلون", "آن لائن ڈرائیور"), L("drivers_with_jobs", "Drivers with jobs", "سائقون لديهم مهام", "کام والے ڈرائیور"),
  L("fleet", "Drivers", "السائقون", "ڈرائیور"), L("drivers_active", "Active drivers", "السائقون النشطون", "فعال ڈرائیور"), L("links", "Joined", "انضموا", "شامل ہوئے"), L("unlinks", "Left", "غادروا", "چھوڑ گئے"),
  // offers
  L("offered", "Offers received", "العروض المستلمة", "موصول پیشکشیں"), L("declined", "Declined", "المرفوضة", "مسترد"), L("timedout", "Timed out", "منتهية دون رد", "جواب کے بغیر ختم"),
  L("decline_rate", "Decline rate", "نسبة الرفض", "مسترد کرنے کی شرح"), L("acceptance", "Offer acceptance", "قبول العروض", "پیشکش کی قبولیت"), L("resp_avg", "Avg. response time", "متوسط زمن الاستجابة", "اوسط جواب کا وقت"),
  L("resp_p90", "Response time (90th pct.)", "زمن الاستجابة (الشريحة 90)", "جواب کا وقت (90واں فیصد)"), L("cancelled", "Cancelled by driver", "ألغاها السائق", "ڈرائیور نے منسوخ کیں"),
  // activity
  L("jobs", "Jobs", "المهام", "کام"), L("active_days", "Active days", "أيام النشاط", "فعال دن"), L("online_days", "Online days", "أيام التواجد", "آن لائن دن"),
  L("jobs_per_active_day", "Jobs per active day", "المهام لكل يوم نشاط", "فی فعال دن کام"), L("parcels_per_active_day", "Parcels per active day", "الطرود لكل يوم نشاط", "فی فعال دن پارسل"),
  L("online", "Online time", "وقت التواجد", "آن لائن وقت"), L("deliv_per_online_hour", "Delivered per online hour", "المسلَّم لكل ساعة تواجد", "فی آن لائن گھنٹہ ڈیلیوری"), L("parcels_per_job", "Parcels per job", "الطرود لكل مهمة", "فی کام پارسل"),
  // punctuality
  L("punctual", "On time (by start)", "في الموعد أو قبله", "وقت پر (آغاز تک)"), L("late", "Late (within grace)", "متأخر (ضمن المهلة)", "تاخیر (رعایتی وقت کے اندر)"), L("very_late", "Very late", "متأخر جدًا", "بہت تاخیر"),
  L("on_time", "On time", "في الموعد", "وقت پر"), L("late_avg_min", "Avg. lateness (min)", "متوسط التأخر (د)", "اوسط تاخیر (منٹ)"), L("arrival_delta_avg_min", "Arrival vs start (min)", "الوصول مقابل البدء (د)", "آمد بمقابلہ آغاز (منٹ)"),
  // warehouse and route time
  L("attend_avg_min", "Check-in wait (min)", "انتظار التأكيد (د)", "حاضری کا انتظار (منٹ)"), L("load_avg_min", "Loading time (min)", "مدة التحميل (د)", "لوڈنگ کا وقت (منٹ)"),
  L("wait_avg_min", "Warehouse wait (min)", "الانتظار في المستودع (د)", "گودام میں انتظار (منٹ)"), L("plan_avg_min", "Route review (min)", "مراجعة المسار (د)", "روٹ کا جائزہ (منٹ)"),
  L("stop_avg_min", "Time at the door (min)", "الوقت عند الباب (د)", "دروازے پر وقت (منٹ)"), L("parcel_avg_min", "Load to delivered (min)", "من التحميل إلى التسليم (د)", "لوڈ سے ڈیلیوری تک (منٹ)"),
  L("job_avg_min", "Job duration (min)", "مدة المهمة (د)", "کام کا دورانیہ (منٹ)"),
  // distance
  L("radius_m", "Radius distance", "المسافة الشعاعية", "ریڈیل فاصلہ"), L("route_m", "Route distance", "مسافة المسار", "روٹ کا فاصلہ"), L("gps_m", "GPS distance", "مسافة GPS", "GPS فاصلہ"),
  // parcels
  L("delivered", "Delivered", "المسلَّمة", "ڈیلیور شدہ"), L("failed", "Failed", "الفاشلة", "ناکام"), L("returned", "Returned", "المرتجعة", "واپس"), L("pending_parcels", "Parcels pending", "طرود قيد التنفيذ", "زیر التواء پارسل"),
  L("success", "Delivery success", "نجاح التسليم", "ڈیلیوری کی کامیابی"), L("first_attempt", "First-attempt rate", "التسليم من المحاولة الأولى", "پہلی کوشش میں ڈیلیوری"), L("deferrals", "Postponements", "التأجيلات", "التوا"),
  L("proof_otp", "Proof by code", "إثبات بالرمز", "کوڈ سے ثبوت"), L("proof_receipt", "Proof by receipt", "إثبات بإيصال", "رسید سے ثبوت"), L("cod_parcels", "Cash-on-delivery parcels", "طرود الدفع عند الاستلام", "کیش آن ڈیلیوری پارسل"),
  // quality
  L("rating", "Rating", "التقييم", "ریٹنگ"), L("rating_count", "Ratings", "عدد التقييمات", "ریٹنگز"), L("stars1", "1 star", "نجمة واحدة", "1 ستارہ"), L("stars2", "2 stars", "نجمتان", "2 ستارے"),
  L("stars3", "3 stars", "3 نجوم", "3 ستارے"), L("stars4", "4 stars", "4 نجوم", "4 ستارے"), L("stars5", "5 stars", "5 نجوم", "5 ستارے"),
  L("complaints", "Complaints", "الشكاوى", "شکایات"), L("complaints_open", "Open complaints", "الشكاوى المفتوحة", "کھلی شکایات"), L("strikes", "Cancellations (strikes)", "الإلغاءات (المخالفات)", "منسوخیاں (اسٹرائیک)"),
  L("suspensions", "Suspensions", "الإيقافات", "معطلیاں"),
  // money
  L("customer", "Customer price", "سعر العميل", "کسٹمر کی قیمت"), L("earn", "Earnings (provider net)", "المستحقات (صافي المزوّد)", "آمدنی (فراہم کنندہ کا خالص)"), L("margin", "Platform margin", "هامش المنصة", "پلیٹ فارم مارجن"),
  L("vat", "VAT", "ضريبة القيمة المضافة", "ویٹ"), L("refund", "Refunds", "المبالغ المستردة", "ریفنڈ"), L("adjust", "Adjustments", "التعديلات", "ایڈجسٹمنٹس"), L("paid", "Paid out", "المصروف", "ادا شدہ"),
  L("pending", "Awaiting payout", "بانتظار الصرف", "ادائیگی کے منتظر"), L("cod_collected", "COD collected", "النقد المحصَّل", "وصول شدہ کیش"), L("cod_remitted", "COD handed in", "النقد المُسلَّم", "جمع کرایا گیا کیش"),
  L("cod_held", "COD held", "النقد بحوزة السائق", "ڈرائیور کے پاس کیش"), L("earn_per_job", "Earnings per job", "المستحق لكل مهمة", "فی کام آمدنی"), L("earn_per_parcel", "Earnings per parcel", "المستحق لكل طرد", "فی پارسل آمدنی"),
  L("earn_per_hour", "Earnings per online hour", "المستحق لكل ساعة تواجد", "فی آن لائن گھنٹہ آمدنی"),
  // rows of the jobs, earnings and failures tables
  L("order", "Order", "الطلب", "آرڈر"), L("starts_at", "Start time", "وقت البدء", "آغاز کا وقت"), L("arrived_at", "Arrived", "وقت الوصول", "آمد کا وقت"), L("late_min", "Late (min)", "التأخر (د)", "تاخیر (منٹ)"),
  L("wait_min", "Warehouse wait (min)", "الانتظار في المستودع (د)", "گودام میں انتظار (منٹ)"), L("load_min", "Loading (min)", "التحميل (د)", "لوڈنگ (منٹ)"), L("plan_min", "Route review (min)", "مراجعة المسار (د)", "روٹ کا جائزہ (منٹ)"),
  L("expected", "Parcels expected", "الطرود المتوقعة", "متوقع پارسل"), L("status", "Status", "الحالة", "حیثیت"), L("reason", "Reason", "السبب", "وجہ"), L("count", "Parcels", "عدد الطرود", "پارسل"),
  L("share", "Share", "النسبة", "حصہ"), L("drivers_affected", "Drivers affected", "السائقون المتأثرون", "متاثرہ ڈرائیور"), L("created_at", "Created", "تاريخ الإنشاء", "بنایا گیا"), L("paid_at", "Paid on", "تاريخ الدفع", "ادائیگی کی تاریخ"),
];
