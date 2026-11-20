import type { Rng } from "./prng";

/**
 * Vocabulary of the generator: clearly fictitious people, businesses and messages in the Arabic / English mix the platform's own demo data uses.
 * No real company names are used.
 */
type Pair = readonly [en: string, ar: string];

// ── people ──
const SAUDI_FIRST: readonly Pair[] = [["Mohammed", "محمد"], ["Abdullah", "عبدالله"], ["Fahad", "فهد"], ["Sultan", "سلطان"], ["Khalid", "خالد"], ["Nasser", "ناصر"], ["Saud", "سعود"], ["Turki", "تركي"],
  ["Bandar", "بندر"], ["Majed", "ماجد"], ["Ahmed", "أحمد"], ["Youssef", "يوسف"], ["Ibrahim", "إبراهيم"], ["Omar", "عمر"], ["Faisal", "فيصل"], ["Salman", "سلمان"], ["Rakan", "راكان"], ["Mishal", "مشعل"], ["Talal", "طلال"], ["Waleed", "وليد"]];
const FEMALE_FIRST: readonly Pair[] = [["Noura", "نورة"], ["Sara", "سارة"], ["Reem", "ريم"], ["Hind", "هند"], ["Lina", "لينا"], ["Mona", "منى"], ["Rima", "ريما"], ["Amani", "أماني"], ["Dana", "دانة"], ["Joud", "جود"],
  ["Al Anoud", "العنود"], ["Shahd", "شهد"], ["Lama", "لمى"], ["Ghada", "غادة"], ["Maha", "مها"], ["Haya", "هيا"], ["Abeer", "عبير"], ["Jawaher", "جواهر"]];
const FAMILY: readonly Pair[] = [["Alotaibi", "العتيبي"], ["Alqahtani", "القحطاني"], ["Aldosari", "الدوسري"], ["Alzahrani", "الزهراني"], ["Alghamdi", "الغامدي"], ["Alshammari", "الشمري"], ["Almutairi", "المطيري"],
  ["Alharbi", "الحربي"], ["Alsubaie", "السبيعي"], ["Alanazi", "العنزي"], ["Alshehri", "الشهري"], ["Albalawi", "البلوي"], ["Alrashidi", "الرشيدي"], ["Alyami", "اليامي"], ["Almalki", "المالكي"], ["Alsaadi", "السعدي"], ["Alkhaldi", "الخالدي"]];
/** Expatriate drivers are a large part of the real workforce: the platform's demo drivers already include them. */
const EXPAT_FIRST: readonly string[] = ["Bilal", "Tariq", "Yusuf", "Imran", "Zahid", "Rashid", "Adnan", "Shahid", "Kamran", "Naveed", "Sajid", "Waqar", "Hamza", "Mustafa", "Ali", "Hassan", "Karim", "Samir", "Mahmoud", "Ayman", "Rafiq", "Anwar", "Jamal", "Nabil"];
const EXPAT_LAST: readonly string[] = ["Ahmed", "Khan", "Mahmood", "Hussain", "Malik", "Iqbal", "Ali", "Sheikh", "Abbas", "Siddiqui", "Hassan", "Ibrahim", "Saleh", "Farouk", "Mansour", "Othman", "Rahman", "Chaudhry"];

export type Lang = "en" | "ar";
export function saudiName(rng: Rng, lang: Lang, female = false): string {
  const f = rng.pick(female ? FEMALE_FIRST : SAUDI_FIRST), l = rng.pick(FAMILY);
  return lang === "ar" ? `${f[1]} ${l[1]}` : `${f[0]} ${l[0]}`;
}
export function expatName(rng: Rng): string { return `${rng.pick(EXPAT_FIRST)} ${rng.pick(EXPAT_LAST)}`; }
export function driverName(rng: Rng): string { return rng.chance(0.42) ? saudiName(rng, "en") : expatName(rng); }
/** Parcel recipients: mostly Arabic names, some English. */
export function recipientName(rng: Rng, business = false, shop?: string): string {
  if (business) return shop ?? rng.pick(SHOPS);
  return saudiName(rng, rng.chance(0.78) ? "ar" : "en", rng.chance(0.4));
}

// ── businesses ──
const SHOPS = ["صيدلية النور", "بقالة الأمل", "مطعم الديرة", "عيادة الشفاء", "ورشة السلام", "مكتبة المعرفة", "مخبز الفرن الذهبي", "متجر الإلكترونيات الحديثة", "كوفي لاب", "سوبرماركت البركة", "صالون لمسة", "مركز الصيانة السريعة",
  "حلويات الروضة", "معرض الأثاث العصري", "مغسلة البيضاء", "شركة الأفق للمقاولات", "مختبر الحياة الطبي", "محل العطور الملكية", "مركز الهدى للتدريب", "استوديو الصورة", "مكتب الرؤية للمحاسبة", "مطبعة الإتقان"];

export interface Industry {
  key: string; label: string; suffix: Pair; contents: readonly string[];
  /** share of parcels that are cash on delivery / delivered to businesses */
  cod: number; b2b: number; vehicles: ReadonlyArray<readonly [string, number]>; parcelScale: number;
}
export const INDUSTRIES: readonly Industry[] = [
  { key: "food", label: "Food & Grocery", suffix: ["Fresh Foods", "للأغذية الطازجة"], contents: ["مواد غذائية", "خضار وفواكه", "منتجات ألبان", "وجبات جاهزة", "تمور", "قهوة"], cod: 0.2, b2b: 0.3, vehicles: [["sedan", 4], ["dokker", 4], ["van", 2], ["hiace", 1]], parcelScale: 1.1 },
  { key: "ecom", label: "E-commerce", suffix: ["Online Store", "للتجارة الإلكترونية"], contents: ["ملابس", "أجهزة إلكترونية", "أحذية", "حقيبة", "ألعاب أطفال", "أدوات مطبخ", "مستلزمات منزلية"], cod: 0.62, b2b: 0.05, vehicles: [["sedan", 6], ["dokker", 3], ["hiace", 1]], parcelScale: 1.0 },
  { key: "pharma", label: "Pharmacy & Medical", suffix: ["Pharmacy", "للصيدلة"], contents: ["أدوية", "مستلزمات طبية", "مكملات غذائية", "أجهزة قياس"], cod: 0.1, b2b: 0.35, vehicles: [["sedan", 6], ["dokker", 2], ["van", 2]], parcelScale: 0.7 },
  { key: "electronics", label: "Electronics", suffix: ["Electronics", "للإلكترونيات"], contents: ["هاتف جوال", "أجهزة إلكترونية", "ملحقات", "شاشات", "سماعات"], cod: 0.4, b2b: 0.15, vehicles: [["sedan", 4], ["dokker", 4], ["hiace", 2]], parcelScale: 0.9 },
  { key: "fashion", label: "Fashion & Beauty", suffix: ["Fashion House", "للأزياء"], contents: ["ملابس", "عطور", "مستحضرات تجميل", "أحذية", "حقائب"], cod: 0.55, b2b: 0.04, vehicles: [["sedan", 8], ["dokker", 2]], parcelScale: 0.8 },
  { key: "furniture", label: "Furniture & Home", suffix: ["Furniture", "للأثاث"], contents: ["أثاث", "ستائر", "سجاد", "أدوات منزلية"], cod: 0.3, b2b: 0.2, vehicles: [["hiace", 4], ["van", 3], ["dyna", 2], ["dokker", 2]], parcelScale: 0.5 },
  { key: "restaurant", label: "Restaurants & Catering", suffix: ["Catering", "للتموين"], contents: ["وجبات جاهزة", "حلويات", "مشروبات", "تموين"], cod: 0.25, b2b: 0.5, vehicles: [["sedan", 4], ["van", 4], ["dokker", 2], ["dyna", 1]], parcelScale: 0.9 },
  { key: "auto", label: "Auto Parts", suffix: ["Auto Parts", "لقطع الغيار"], contents: ["قطع غيار", "إطارات", "زيوت", "بطاريات"], cod: 0.35, b2b: 0.55, vehicles: [["dokker", 5], ["hiace", 3], ["sedan", 2], ["dyna", 1]], parcelScale: 0.7 },
  { key: "office", label: "Office & Stationery", suffix: ["Office Supplies", "للمستلزمات المكتبية"], contents: ["مستندات", "كتب", "مستلزمات مكتبية", "طابعات"], cod: 0.12, b2b: 0.8, vehicles: [["sedan", 7], ["dokker", 2]], parcelScale: 0.8 },
  { key: "gifts", label: "Flowers & Gifts", suffix: ["Gifts & Flowers", "للهدايا والزهور"], contents: ["ورد", "هدايا", "حلويات", "عطور"], cod: 0.3, b2b: 0.1, vehicles: [["sedan", 9], ["dokker", 1]], parcelScale: 0.6 },
  { key: "cold", label: "Cold Chain & Fresh", suffix: ["Cold Chain", "للتبريد"], contents: ["أسماك", "لحوم", "مجمدات", "منتجات ألبان"], cod: 0.1, b2b: 0.6, vehicles: [["van", 6], ["dyna", 2], ["dokker", 2]], parcelScale: 0.8 },
];

const PREFIX: readonly Pair[] = [["Wadi Al Nakheel", "وادي النخيل"], ["Qamar", "قمر"], ["Rimal", "رمال"], ["Sahab", "سحاب"], ["Tamr", "تمر"], ["Zahrat Al Rawdah", "زهرة الروضة"], ["Bayt Al Qahwa", "بيت القهوة"],
  ["Hayat", "حياة"], ["Najd", "نجد"], ["Marmar", "مرمر"], ["Saqr", "صقر"], ["Waha", "واحة"], ["Layali", "ليالي"], ["Sunbula", "سنبلة"], ["Duha", "ضحى"], ["Fajr", "فجر"], ["Gharsa", "غرسة"], ["Hilal", "هلال"],
  ["Ibtisama", "ابتسامة"], ["Jawhara", "جوهرة"], ["Khuzama", "خزامى"], ["Lulu Al Khaleej", "لؤلؤ الخليج"], ["Manarat", "منارة"], ["Nawras", "نورس"], ["Oasis Riyadh", "واحة الرياض"], ["Raha", "راحة"],
  ["Sidra", "سدرة"], ["Tala", "تلال"], ["Wahaj", "وهج"], ["Yasmeen", "ياسمين"], ["Zaytoun", "زيتون"], ["Bareeq", "بريق"], ["Dalla", "دلة"], ["Ghaym", "غيم"], ["Hessa", "حصة"], ["Mazaya", "مزايا"], ["Nabd", "نبض"],
  ["Qimam", "قمم"], ["Rawabi Al Sharq", "روابي الشرق"], ["Shams", "شمس"], ["Taj Al Najd", "تاج نجد"], ["Uns", "أنس"], ["Safwa", "صفوة"], ["Rayyan", "ريان"], ["Athar", "أثر"]];

export interface CompanyName { en: string; ar: string; display: string }
export function companyName(rng: Rng, ind: Industry, used: Set<string>): CompanyName {
  for (let i = 0; i < 60; i++) {
    const p = rng.pick(PREFIX);
    const en = `${p[0]} ${ind.suffix[0]}`;
    if (used.has(en)) continue;
    used.add(en);
    const ar = `${ind.suffix[1].startsWith("لل") ? "مؤسسة" : "شركة"} ${p[1]} ${ind.suffix[1]}`;
    return { en, ar, display: rng.chance(0.3) ? ar : en };
  }
  const en = `${rng.pick(PREFIX)[0]} ${ind.suffix[0]} ${used.size + 1}`; used.add(en);
  return { en, ar: en, display: en };
}
const OFFICE_WORDS: readonly Pair[] = [["Al Wasila", "الوسيلة"], ["Sari'", "سريع"], ["Al Tawseel", "التوصيل"], ["Najm Al Layl", "نجم الليل"], ["Al Rahhal", "الرحال"], ["Burooj", "بروج"], ["Al Masar", "المسار"], ["Hamam", "حمام"],
  ["Al Bareed Al Akhdar", "البريد الأخضر"], ["Taysir", "تيسير"], ["Al Ittijah", "الاتجاه"], ["Khutwa", "خطوة"], ["Al Safar", "السفر"], ["Rukub", "ركب"], ["Dirb", "درب"]];
export function officeName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 40; i++) { const w = rng.pick(OFFICE_WORDS); const n = `${w[0]} Courier Office`; if (!used.has(n)) { used.add(n); return rng.chance(0.25) ? `مكتب ${w[1]} للتوصيل` : n; } }
  const n = `Courier Office ${used.size + 1}`; used.add(n); return n;
}

// ── parcels ──
export const NOTES_PARCEL = ["الاتصال قبل الوصول", "البوابة الثانية", "الدور الثالث — شقة 7", "المحل يفتح بعد الظهر", "Call before arrival", "Leave with reception", "Fragile — handle with care", "Gate code on arrival", null, null, null, null, null, null] as const;
export const FAIL_NOTES: Record<string, readonly string[]> = {
  wrong_address: ["العنوان غير موجود في الحي", "Address not found on that street", "الموقع على الخريطة غير دقيق", "Building number does not exist"],
  other: ["Recipient asked to reschedule", "المستلم طلب تأجيل التسليم", "Parcel refused by security guard"],
  damaged: ["العبوة تالفة عند الاستلام", "Box was crushed in the vehicle"],
  unreachable: ["Phone switched off after 3 calls", "لا يرد على الاتصال"], refused: ["Customer cancelled the order", "رفض الاستلام"], closed: ["المحل مغلق", "Shop closed until evening"],
  no_otp: ["Recipient could not find the code SMS", "لم يصل رمز الاستلام للمستلم"], gate_access: ["Compound gate refused entry", "الحارس منع الدخول"], out_of_zone: ["Outside the delivery area", "خارج نطاق التوصيل"],
};
export const DEFER_NOTES = ["المستلم طلب المرور لاحقاً", "Customer asked to come back in an hour", "المحل مغلق مؤقتاً", "Recipient not home — coming back", "Waiting for the receiver to arrive"];
export const NO_SHOW_REASONS = ["Driver did not arrive at the warehouse", "لم يصل المندوب إلى المستودع", "Driver unreachable by phone", "No show after 30 minutes"];
export const DRIVER_CANCEL_REASONS = ["Vehicle breakdown", "عطل في السيارة", "Family emergency", "ظرف طارئ", "Sick today", "Double-booked by mistake", "Too far from my location", "Road closure"];
export const BIZ_CANCEL_REASONS = ["Order batch cancelled by the customer", "تم إلغاء الدفعة من العميل", "Wrong delivery date", "Created by mistake", "Stock not ready", "المخزون غير جاهز", "Changed the delivery city"];
export const OPS_REPLACE_REASONS = ["Driver reported sick", "Low rating on previous jobs", "Vehicle not suitable for the load", "Driver requested replacement"];
export const END_ROUTE_REASONS = ["vehicle_breakdown", "accident", "illness", "family_emergency", "phone_battery"];

// ── chat ──
export const CHAT_BIZ = ["Please call me when you arrive", "The parcels are ready at gate 2", "الرجاء الوصول قبل الموعد", "Use the loading dock at the back", "المستودع يفتح الساعة 9", "Please scan every parcel before leaving", "Need cold box for the last 5 parcels", "ممكن تنتظر عشر دقائق؟"];
export const CHAT_DRIVER = ["On my way", "في الطريق", "Arrived at the warehouse", "وصلت للموقع", "I am stuck in traffic, 15 minutes late", "تأخرت قليلاً بسبب الزحمة", "Loaded and starting the route", "Customer is not answering", "المستلم لا يرد", "Done, all delivered"];

// ── support ──
export interface TicketText { subject: string; body: string }
const T = (subject: string, body: string): TicketText => ({ subject, body });
export const TICKET_TEXTS: Record<string, readonly TicketText[]> = {
  driver_no_show: [T("Driver did not show up", "The driver assigned to my order never arrived. Please send a replacement."), T("المندوب لم يحضر", "المندوب المعين لطلبي لم يصل إلى المستودع، أرجو إرسال بديل.")],
  shipment_count: [T("Parcel count is different", "The driver says he received fewer parcels than we handed over."), T("عدد الشحنات غير مطابق", "المندوب يقول إنه استلم شحنات أقل مما سلمناه.")],
  location_issue: [T("Recipient pin is wrong", "Several parcels have wrong map pins. Can you check the route?"), T("الموقع على الخريطة خاطئ", "عدة شحنات موقعها خاطئ على الخريطة.")],
  payment_issue: [T("Wallet balance does not match", "My wallet balance is lower than I expected after the last order."), T("الرصيد غير مطابق", "رصيد المحفظة أقل مما توقعت بعد آخر طلب."), T("Payout not received", "I completed jobs last week but the money is not in my wallet yet.")],
  cod_issue: [T("Cash on delivery not settled", "The driver says he handed over the cash but the system still shows an outstanding amount."), T("المبلغ المحصل لم يسجل", "السائق سلّم المبلغ ولم يظهر في النظام.")],
  replacement_request: [T("Need a replacement driver", "Please replace the driver, he is running very late."), T("أحتاج مندوباً بديلاً", "أرجو استبدال المندوب بسبب التأخير الكبير.")],
  urgent: [T("Urgent: delivery stuck", "Our delivery is stuck and customers are waiting."), T("عاجل: التوصيل متوقف", "التوصيل متوقف والعملاء بانتظارنا.")],
  app_problem: [T("App is not loading", "The app shows a blank screen after the update."), T("مشكلة في التطبيق", "التطبيق لا يفتح بعد التحديث."), T("Cannot scan parcel barcode", "The scanner does not read the labels printed by the warehouse.")],
  other: [T("Question about invoices", "Can you send me the invoices for last month?"), T("استفسار عام", "أرغب في معرفة تفاصيل الأسعار.")],
  business_not_ready: [T("Warehouse not ready", "I arrived on time but the goods were not ready for loading."), T("المستودع غير جاهز", "وصلت في الموعد والبضاعة غير جاهزة.")],
  not_put_to_work: [T("Not put to work", "I have been waiting for an hour and nobody gave me parcels."), T("لم يتم تشغيلي", "أنتظر منذ ساعة ولم يسلمني أحد الشحنات.")],
  shipment_count_differs: [T("Loaded quantity differs", "The warehouse recorded more parcels than I received."), T("الكمية المحملة مختلفة", "المستودع سجل عدداً أكبر مما استلمت.")],
  attendance_issue: [T("Attendance not confirmed", "I checked in but the warehouse did not confirm my attendance."), T("الحضور لم يؤكد", "سجلت حضوري ولم يؤكده المستودع.")],
  driver_assignment: [T("Assign drivers to a job", "We have free drivers but no offers reach them."), T("إسناد المندوبين", "لدينا مندوبون متاحون ولا تصلهم عروض.")],
  settlement_issue: [T("Settlement amount is lower", "The payout for last week is lower than our statement."), T("مبلغ التسوية أقل", "مبلغ التسوية أقل من كشف الحساب.")],
  agreement: [T("Agreement renewal", "Our agreement expires soon, what are the next steps?"), T("تجديد الاتفاقية", "تنتهي اتفاقيتنا قريباً، ما الخطوات؟")],
  documents: [T("Document was rejected", "Why was my commercial registration rejected? It is valid."), T("تم رفض المستند", "لماذا رُفض السجل التجاري وهو ساري؟")],
};
export const STAFF_REPLIES = ["Thank you for contacting us. We are looking into it now.", "شكراً لتواصلك، نحن نراجع الموضوع الآن.", "We checked the order and found the cause. A correction was applied.", "تم التحقق من الطلب وتصحيح المشكلة.",
  "Could you share the order reference and a screenshot?", "هل يمكنك إرسال رقم الطلب ولقطة شاشة؟", "A replacement driver has been arranged.", "تم ترتيب مندوب بديل.", "The amount was credited to your wallet.", "تمت إضافة المبلغ إلى محفظتك.",
  "This was caused by a wrong pin. We updated the route.", "We escalated this to operations and will update you shortly."];
export const USER_FOLLOWUPS = ["Thanks, I will check.", "شكراً لكم.", "It is still not working.", "ما زالت المشكلة موجودة.", "Here is the screenshot.", "Yes, the issue is solved now.", "تم حل المشكلة، شكراً.", "Please call me on this number."];
export const STAFF_INTERNAL = ["Checked the audit log: the cancellation came from the customer.", "Spoke with the driver by phone, confirmed the story.", "Escalated to finance for a goodwill credit.", "Customer is a key account — handle with priority.",
  "Duplicate of an earlier ticket, merged.", "Waiting for the warehouse to confirm the count."];
export const COMPLAINT_TEXTS: Record<string, readonly string[]> = {
  delay: ["The driver arrived 90 minutes late and my customers complained.", "تأخر المندوب أكثر من ساعة ونصف على الموعد."],
  behavior: ["The driver was rude to the warehouse staff.", "تعامل المندوب كان غير لائق مع موظفي المستودع."],
  service_quality: ["Several parcels were delivered with damaged packaging.", "عدة شحنات وصلت والتغليف تالف."],
  payment: ["The payout does not match the delivered parcels.", "مبلغ الدفع لا يطابق الشحنات المسلمة."],
  custody: ["The phone charger handed to the driver was not returned.", "لم يتم إرجاع الشاحن الذي سُلّم للمندوب."],
  damage: ["A fragile parcel arrived broken and the recipient refused it.", "شحنة قابلة للكسر وصلت مكسورة ورفضها المستلم."],
  no_show: ["The driver accepted the job and never came.", "المندوب قبل الطلب ولم يحضر."],
  other: ["I would like to report a problem with the last job.", "أرغب في الإبلاغ عن مشكلة في آخر طلب."],
};
export const COMPLAINT_RESOLUTIONS = ["Verified with both sides; a warning was recorded for the driver.", "تم التحقق من الطرفين وتسجيل ملاحظة على المندوب.", "Refund issued to the customer's wallet.", "تم رد المبلغ إلى المحفظة.",
  "No fault found — evidence shows delivery on time.", "No action needed, the issue was resolved with the warehouse.", "Goodwill credit applied and the case closed."];
export const NOTE_TEXTS: Record<string, readonly string[]> = {
  user: ["Called the account owner, will upload the missing document tomorrow.", "Key account — assign to the senior support agent.", "Driver warned about late arrivals.", "Verified IBAN by phone.", "Customer asked for a credit-limit review next month.", "Office manager prefers WhatsApp contact."],
  request: ["Business asked to prioritise this order.", "Pickup address corrected by phone.", "Driver delayed because of road works.", "Escalated: recipient complained twice."],
  ticket: ["Waiting for the warehouse answer.", "Root cause: wrong map pin on 3 parcels.", "Customer is upset, call back today."],
  complaint: ["Statement received from the driver.", "Evidence photos attached by the business.", "Settlement hold kept until the investigation ends."],
  settlement: ["Held until the complaint is resolved.", "Checked the margin with finance."],
  withdrawal: ["IBAN confirmed with the bank statement.", "Name on the account differs, asked the user to confirm."],
  offer: ["Driver arrived late, no penalty applied.", "Replacement accepted quickly."],
  shipment: ["Recipient called support: parcel arrived damaged.", "Returned to warehouse after 2 failed attempts."],
};
export const REVIEW_NOTES_REJECT = ["The document is not readable, please upload a clearer photo.", "المستند منتهي الصلاحية.", "Name on the document does not match the account.", "الصورة غير واضحة."];
export const WITHDRAWAL_REJECT = ["IBAN does not match the account holder name.", "Please update your bank details and request again.", "رقم الآيبان غير صحيح."];
export const COMMENTS_GOOD = ["Fast and polite", "ممتاز وملتزم بالموعد", "Great service", "Very professional", "توصيل سريع", "On time and careful with the parcels", "شكراً"];
export const COMMENTS_BAD = ["Late arrival", "تأخر كثيراً", "Parcels were not handled well", "Did not answer calls", "ما رد على الاتصالات"];
export const COMMENTS_BIZ_GOOD = ["Warehouse was ready", "تعامل راقٍ", "Clear instructions"];
export const COMMENTS_BIZ_BAD = ["Waited too long for the parcels", "انتظرت طويلاً قبل التحميل"];

export const USER_AGENTS = {
  android: ["JRDriver/1.4.2 (Android 14; SM-S918B)", "JRDriver/1.4.1 (Android 13; Pixel 7)", "JRDriver/1.4.2 (Android 12; TECNO KG5)", "JRDriver/1.3.9 (Android 11; Redmi Note 10)"],
  ios: ["JRApp/1.4.2 (iOS 17.4; iPhone14,5)", "JRApp/1.4.0 (iOS 16.7; iPhone12,1)"],
  web: ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) Safari/605.1.15", "Mozilla/5.0 (X11; Linux x86_64) Firefox/125.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/604.1"],
};
