import type { Dict } from "../core";

/**
 * Update J2 / J3 (worker F2): Settings › Field operations switches (routing, B2B shipments), the driver's shipment run sheet (one card per shipment)
 * and the business manifest / import / API-docs wording while B2B shipments are off. Every key starts with `jf2.`.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // ───────── Settings › Field operations: the two platform switches ─────────
  ["jf2.set_ops_title", "Platform switches", "مفاتيح المنصة", "پلیٹ فارم سوئچ"],
  ["jf2.set_ops_sub", "Two switches that change how drivers and companies work. Each one takes effect immediately for new actions; nothing that is already saved is rewritten.",
    "مفتاحان يغيّران طريقة عمل المناديب والمنشآت. يسري كل منهما فوراً على الإجراءات الجديدة، ولا يُعاد كتابة أي شيء محفوظ مسبقاً.",
    "دو سوئچ جو ڈرائیوروں اور کمپنیوں کے کام کا طریقہ بدلتے ہیں۔ ہر ایک نئی کارروائیوں پر فوراً لاگو ہوتا ہے؛ پہلے سے محفوظ کچھ بھی دوبارہ نہیں لکھا جاتا۔"],
  ["jf2.set_ops_readonly", "You can view them but not change them.", "يمكنك عرضهما دون تغييرهما.", "آپ انہیں دیکھ سکتے ہیں مگر بدل نہیں سکتے۔"],
  ["jf2.sw_on", "On", "مفعّل", "آن"],
  ["jf2.sw_off", "Off", "متوقف", "آف"],
  ["jf2.sw_when_off", "When it is off", "عند الإيقاف", "بند ہونے پر"],
  ["jf2.sw_when_on", "When it is on", "عند التفعيل", "آن ہونے پر"],
  ["jf2.sw_who", "Who is affected", "من يتأثر", "کس پر اثر پڑتا ہے"],
  ["jf2.sw_immediate", "Takes effect immediately for new actions.", "يسري فوراً على الإجراءات الجديدة.", "نئی کارروائیوں پر فوراً لاگو ہوتا ہے۔"],
  ["jf2.set_reorder_needs_routing", "Only applies while Routing is on.", "لا يُطبَّق إلا أثناء تفعيل تخطيط المسار.", "یہ صرف اس وقت لاگو ہوتا ہے جب روٹنگ آن ہو۔"],

  ["jf2.rt_title", "Routing", "تخطيط المسار", "روٹنگ"],
  ["jf2.rt_lead", "Plans the best delivery route with Google and makes the driver serve one stop at a time.",
    "يخطّط أفضل مسار توصيل عبر Google ويجعل المندوب يخدم نقطة واحدة في كل مرة.",
    "گوگل کے ذریعے بہترین ڈیلیوری روٹ بناتا ہے اور ڈرائیور کو ایک وقت میں ایک اسٹاپ تک پابند کرتا ہے۔"],
  ["jf2.rt_off_1", "No route is planned and Google is never called.", "لا يُخطَّط أي مسار ولا يُستدعى Google إطلاقاً.", "کوئی روٹ نہیں بنتا اور گوگل کو کبھی کال نہیں جاتی۔"],
  ["jf2.rt_off_2", "No “approve route” step: after loading, the driver goes straight to the shipments.", "لا توجد خطوة «اعتماد المسار»: بعد التحميل ينتقل المندوب مباشرة إلى الشحنات.", "«روٹ منظور کریں» کا مرحلہ نہیں: لوڈنگ کے بعد ڈرائیور سیدھا شپمنٹس پر جاتا ہے۔"],
  ["jf2.rt_off_3", "The driver delivers in any order and sees the name, phone and address of every shipment.", "يسلّم المندوب بأي ترتيب ويرى اسم وهاتف وعنوان كل شحنة.", "ڈرائیور کسی بھی ترتیب سے ڈیلیور کرتا ہے اور ہر شپمنٹ کا نام، فون اور پتہ دیکھتا ہے۔"],
  ["jf2.rt_off_4", "The route map, re-ordering and optimising are hidden.", "تُخفى خريطة المسار وإعادة الترتيب والتحسين.", "روٹ کا نقشہ، ترتیب بدلنا اور آپٹمائز چھپ جاتے ہیں۔"],
  ["jf2.rt_on_1", "A best route is planned for each job and the driver approves it before starting.", "يُخطَّط أفضل مسار لكل مهمة ويعتمده المندوب قبل البدء.", "ہر کام کے لیے بہترین روٹ بنتا ہے اور ڈرائیور شروع کرنے سے پہلے اسے منظور کرتا ہے۔"],
  ["jf2.rt_on_2", "One stop at a time, in route order; the other shipments are shown but locked.", "نقطة واحدة في كل مرة بترتيب المسار؛ وتظهر بقية الشحنات مقفلة.", "روٹ کی ترتیب سے ایک وقت میں ایک اسٹاپ؛ باقی شپمنٹس نظر آتی ہیں مگر مقفل ہوتی ہیں۔"],
  ["jf2.rt_on_3", "Recipient details appear only for the current stop.", "تظهر بيانات المستلم للنقطة الحالية فقط.", "وصول کنندہ کی تفصیل صرف موجودہ اسٹاپ کی ظاہر ہوتی ہے۔"],
  ["jf2.rt_on_4", "The route map, re-ordering (if allowed) and optimising are available.", "تتوفر خريطة المسار وإعادة الترتيب (إن كانت مسموحة) والتحسين.", "روٹ کا نقشہ، ترتیب بدلنا (اگر اجازت ہو) اور آپٹمائز دستیاب ہیں۔"],
  ["jf2.rt_who", "Drivers on web and mobile. Companies and offices see the same delivery progress either way.", "المناديب على الويب والجوال. تبقى متابعة التسليم لدى المنشآت والمكاتب كما هي في الحالتين.", "ویب اور موبائل پر ڈرائیور۔ کمپنیاں اور دفاتر دونوں صورتوں میں ڈیلیوری کی وہی پیشرفت دیکھتے ہیں۔"],
  ["jf2.rt_note", "A job already in progress when you switch it off simply continues without route approval.", "المهمة الجارية وقت الإيقاف تُكمل ببساطة دون اعتماد المسار.", "بند کرتے وقت جو کام جاری ہو وہ روٹ کی منظوری کے بغیر جاری رہتا ہے۔"],

  ["jf2.b2_title", "B2B shipments", "شحنات المنشآت (B2B)", "کاروباری شپمنٹس (B2B)"],
  ["jf2.b2_lead", "Lets a company mark a recipient as a business (shop, branch, company) instead of an individual.", "يتيح للمنشأة اعتبار المستلم منشأة (محل أو فرع أو شركة) بدلاً من فرد.", "کمپنی کو وصول کنندہ کو فرد کے بجائے کاروبار (دکان، برانچ، کمپنی) کے طور پر نشان زد کرنے دیتا ہے۔"],
  ["jf2.b2_off_1", "Every new shipment is for an individual (B2C) and is delivered with the recipient's code; the recipient-type choice is hidden.", "كل شحنة جديدة تكون لفرد (B2C) وتُسلَّم برمز المستلم؛ ويُخفى خيار نوع المستلم.", "ہر نئی شپمنٹ فرد (B2C) کی ہوتی ہے اور وصول کنندہ کے کوڈ سے ڈیلیور ہوتی ہے؛ وصول کنندہ کی قسم کا انتخاب چھپ جاتا ہے۔"],
  ["jf2.b2_off_2", "The public API and warehouse-system imports turn business recipients into individuals instead of failing.", "تحوّل واجهة API العامة واستيراد أنظمة المستودعات المستلمين من نوع منشأة إلى أفراد بدلاً من الفشل.", "پبلک API اور ویئر ہاؤس سسٹم امپورٹ کاروباری وصول کنندگان کو ناکام کرنے کے بجائے فرد میں بدل دیتے ہیں۔"],
  ["jf2.b2_off_3", "New parcels no longer offer the signed / stamped receipt as proof of delivery.", "لا تعرض الشحنات الجديدة سند الاستلام الموقّع / المختوم كإثبات تسليم.", "نئے پارسلوں میں دستخط/مہر والی رسید ڈیلیوری کے ثبوت کے طور پر پیش نہیں کی جاتی۔"],
  ["jf2.b2_on_1", "Companies choose Individual or Business for each shipment (manifest, import, API).", "تختار المنشآت فرداً أو منشأة لكل شحنة (القائمة والاستيراد وAPI).", "کمپنیاں ہر شپمنٹ کے لیے فرد یا کاروبار منتخب کرتی ہیں (مینی فیسٹ، امپورٹ، API)۔"],
  ["jf2.b2_on_2", "Business recipients may prove receipt with the code or a photo of a signed / stamped receipt.", "يمكن للمستلم من نوع منشأة إثبات الاستلام بالرمز أو بصورة سند موقّع / مختوم.", "کاروباری وصول کنندہ کوڈ یا دستخط/مہر والی رسید کی تصویر سے وصولی ثابت کر سکتا ہے۔"],
  ["jf2.b2_who", "Companies (manifest, import, API, integrations) and the proof options drivers see. Existing business parcels keep working either way and are never rewritten.", "المنشآت (القائمة والاستيراد وAPI والتكاملات) وخيارات الإثبات التي يراها المناديب. تبقى الشحنات القائمة من نوع منشأة تعمل في الحالتين ولا يُعاد كتابتها.", "کمپنیاں (مینی فیسٹ، امپورٹ، API، انٹیگریشنز) اور ڈرائیوروں کو نظر آنے والے ثبوت کے اختیارات۔ موجودہ کاروباری پارسل دونوں صورتوں میں کام کرتے ہیں اور کبھی دوبارہ نہیں لکھے جاتے۔"],

  // ───────── Driver: the shipment run sheet ─────────
  ["jf2.ship_title", "Shipments", "الشحنات", "شپمنٹس"],
  ["jf2.done_of", "{done} of {total} done", "تم إنجاز {done} من {total}", "{total} میں سے {done} مکمل"],
  ["jf2.left_n", "{n} left", "متبقٍ {n}", "{n} باقی"],
  ["jf2.cod_left", "{amount} to collect", "{amount} للتحصيل", "{amount} وصول کرنا باقی"],
  ["jf2.filters_label", "Filter shipments", "تصفية الشحنات", "شپمنٹس فلٹر کریں"],
  ["jf2.search_label", "Search shipments", "البحث في الشحنات", "شپمنٹس تلاش کریں"],
  ["jf2.search_ph", "Search code, name, phone or address", "ابحث بالرمز أو الاسم أو الهاتف أو العنوان", "کوڈ، نام، فون یا پتے سے تلاش کریں"],
  ["jf2.showing", "Showing {shown} of {total}", "عرض {shown} من {total}", "{total} میں سے {shown} دکھائے جا رہے ہیں"],
  ["jf2.show_more", "Show {n} more", "عرض {n} أخرى", "{n} مزید دکھائیں"],
  ["jf2.none_yet", "No shipments on this job yet.", "لا توجد شحنات في هذه المهمة بعد.", "اس کام میں ابھی کوئی شپمنٹ نہیں۔"],
  ["jf2.none_match", "No shipment matches", "لا توجد شحنة مطابقة", "کوئی شپمنٹ مطابق نہیں"],
  ["jf2.none_match_hint", "Try another filter or clear the search.", "جرّب تصفية أخرى أو امسح البحث.", "کوئی اور فلٹر آزمائیں یا تلاش صاف کریں۔"],
  ["jf2.clear_filters", "Clear filters", "مسح التصفية", "فلٹر صاف کریں"],

  ["jf2.f_name", "Name", "الاسم", "نام"],
  ["jf2.f_address", "Address", "العنوان", "پتہ"],
  ["jf2.f_cod", "COD amount", "مبلغ الدفع عند الاستلام", "کیش آن ڈیلیوری رقم"],
  ["jf2.f_payment", "Payment mode", "طريقة الدفع", "ادائیگی کا طریقہ"],
  ["jf2.f_pieces", "Pieces", "عدد القطع", "ٹکڑے"],
  ["jf2.pay_cod", "COD", "الدفع عند الاستلام", "کیش آن ڈیلیوری"],
  ["jf2.pay_prepaid", "Prepaid", "مدفوعة مسبقاً", "پہلے سے ادا شدہ"],
  ["jf2.f_created", "Created {date}", "أُنشئت {date}", "بنائی گئی {date}"],
  ["jf2.f_delivered_at", "Delivered {date}", "سُلّمت {date}", "پہنچائی گئی {date}"],
  ["jf2.name_hidden", "Shown when this stop is next", "يظهر عندما تصبح هذه النقطة التالية", "جب یہ اسٹاپ اگلا ہو تب نظر آئے گا"],
  ["jf2.call_code", "Call the recipient of {code}", "اتصل بمستلم {code}", "{code} کے وصول کنندہ کو کال کریں"],
  ["jf2.wa_code", "WhatsApp the recipient of {code}", "راسل مستلم {code} عبر واتساب", "{code} کے وصول کنندہ کو واٹس ایپ کریں"],
  ["jf2.no_phone", "No phone number available", "لا يوجد رقم هاتف متاح", "فون نمبر دستیاب نہیں"],
  ["jf2.phone_locked", "The phone appears once this stop is next", "يظهر الهاتف عندما تصبح هذه النقطة التالية", "اس اسٹاپ کے اگلے ہونے پر فون نظر آئے گا"],
  ["jf2.copy_address", "Copy address", "نسخ العنوان", "پتہ کاپی کریں"],
  ["jf2.address_copied", "Address copied", "تم نسخ العنوان", "پتہ کاپی ہو گیا"],
  ["jf2.map_code", "Open {code} in maps", "فتح {code} في الخرائط", "{code} کو نقشے میں کھولیں"],
  ["jf2.card_open", "Open shipment {code}", "فتح الشحنة {code}", "شپمنٹ {code} کھولیں"],
  ["jf2.current", "Current stop", "النقطة الحالية", "موجودہ اسٹاپ"],
  ["jf2.arrived", "Arrived", "تم الوصول", "پہنچ گیا"],
  ["jf2.chip_out", "Out for delivery", "خرجت للتوصيل", "ڈیلیوری کے لیے روانہ"],
  ["jf2.chip_delivered", "Delivered", "تم التسليم", "پہنچا دی گئی"],
  ["jf2.chip_failed", "Not delivered", "لم تُسلَّم", "نہیں پہنچی"],
  ["jf2.chip_returned", "Returned", "أُعيدت", "واپس"],
  ["jf2.chip_missing", "Missing", "مفقودة", "لاپتہ"],
  ["jf2.chip_postponed", "Postponed", "مؤجّلة", "مؤخر"],
  ["jf2.chip_pending", "Not loaded yet", "لم تُحمَّل بعد", "ابھی لوڈ نہیں ہوئی"],
  ["jf2.chip_cancelled", "Withdrawn", "مسحوبة", "واپس لی گئی"],

  ["jf2.next_up", "Next up", "التالي", "اگلا"],
  ["jf2.next_arrived", "You are here", "أنت هنا", "آپ یہاں ہیں"],
  ["jf2.next_open", "Open", "فتح", "کھولیں"],
  ["jf2.next_continue", "Continue", "متابعة", "جاری رکھیں"],
  ["jf2.sheet_title", "Shipment {code}", "الشحنة {code}", "شپمنٹ {code}"],
  ["jf2.any_order_hint", "Routing is off: you can deliver this shipment now, in any order.", "تخطيط المسار متوقف: يمكنك تسليم هذه الشحنة الآن بأي ترتيب.", "روٹنگ بند ہے: آپ یہ شپمنٹ ابھی، کسی بھی ترتیب سے ڈیلیور کر سکتے ہیں۔"],
  ["jf2.locked_note", "You can act on this shipment once it becomes your current stop. Until then you can navigate to it.", "يمكنك تنفيذ إجراءات هذه الشحنة عندما تصبح نقطتك الحالية. حتى ذلك الحين يمكنك التنقل إليها.", "جب یہ شپمنٹ آپ کا موجودہ اسٹاپ بنے گی تب اس پر کارروائی ہو سکے گی۔ تب تک آپ وہاں نیویگیٹ کر سکتے ہیں۔"],
  ["jf2.pending_note", "This shipment is not on your vehicle yet.", "هذه الشحنة ليست على مركبتك بعد.", "یہ شپمنٹ ابھی آپ کی گاڑی میں نہیں ہے۔"],
  ["jf2.stops_open", "All your shipments are listed with name, phone and address. Deliver them in any order.", "جميع شحناتك معروضة مع الاسم والهاتف والعنوان. سلّمها بأي ترتيب.", "آپ کی تمام شپمنٹس نام، فون اور پتے کے ساتھ درج ہیں۔ انہیں کسی بھی ترتیب سے ڈیلیور کریں۔"],

  // ───────── Business: manifest, import and API docs while B2B shipments are off ─────────
  ["jf2.import_help_c", "Paste your sheet or upload a .csv / .txt file. Columns: name, phone, address, ref, contents, notes. A header row is optional (English or Arabic names); comma, semicolon or tab separated.",
    "الصق جدولك أو ارفع ملف .csv / .txt. الأعمدة: الاسم، الجوال، العنوان، المرجع، المحتويات، الملاحظات. صف العناوين اختياري (بأسماء عربية أو إنجليزية)، والفاصل فاصلة أو فاصلة منقوطة أو Tab.",
    "اپنی شیٹ پیسٹ کریں یا .csv / .txt فائل اپ لوڈ کریں۔ کالم: نام، فون، پتہ، حوالہ، مواد، نوٹس۔ ہیڈر قطار اختیاری ہے (انگریزی یا عربی ناموں کے ساتھ)؛ کوما، سیمی کولن یا ٹیب سے الگ۔"],
  ["jf2.b2b_coerced_import", "{n} row(s) marked as business will be added as individuals: business recipients are not enabled.", "ستُضاف {n} من الصفوف المحددة كمنشأة على أنها أفراد: المستلمون من نوع منشأة غير مفعّلين.", "کاروباری نشان زد {n} قطاریں فرد کے طور پر شامل ہوں گی: کاروباری وصول کنندگان فعال نہیں ہیں۔"],
  ["jf2.b2b_coerced_row", "Business recipients are not enabled: this parcel will be saved as an individual.", "المستلمون من نوع منشأة غير مفعّلين: ستُحفظ هذه الشحنة كشحنة لفرد.", "کاروباری وصول کنندگان فعال نہیں ہیں: یہ پارسل فرد کے طور پر محفوظ ہوگا۔"],
  ["jf2.api_b2b_title", "Business recipients", "المستلمون من نوع منشأة", "کاروباری وصول کنندگان"],
  ["jf2.api_b2b_off", "Not enabled on this platform. Omit recipientType or send consumer: a business value is converted to consumer (recorded in the order's timeline) and the parcel is delivered with the recipient's code.",
    "غير مفعّلة على هذه المنصة. أهمل recipientType أو أرسل consumer: تُحوَّل القيمة business إلى consumer (ويُسجَّل ذلك في الخط الزمني للطلب) وتُسلَّم الشحنة برمز المستلم.",
    "اس پلیٹ فارم پر فعال نہیں۔ recipientType چھوڑ دیں یا consumer بھیجیں: business کی قدر consumer میں بدل دی جاتی ہے (آرڈر کی ٹائم لائن میں درج ہوتا ہے) اور پارسل وصول کنندہ کے کوڈ سے ڈیلیور ہوتا ہے۔"],
];

const pick = (i: 1 | 2 | 3) => Object.fromEntries(rows.map((r) => [r[0], r[i]])) as Dict;
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
