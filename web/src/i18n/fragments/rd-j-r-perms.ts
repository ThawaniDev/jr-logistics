import type { Dict } from "../core";

/**
 * Labels and one-line descriptions of every permission (Roles & permissions, J8). Keys: `rjp.<permission>` (label) and `rjp.<permission>.d` (description).
 * A unit test (tests/unit/roles-catalog.test.ts) fails when a permission of `ALL_PERMISSIONS` has no entry in en, ar and ur.
 */
type P = [perm: string, enLabel: string, enDesc: string, arLabel: string, arDesc: string, urLabel: string, urDesc: string];
const perms: P[] = [
  ["users.view", "View users", "See the lists and pages of companies, couriers and other accounts.", "عرض المستخدمين", "الاطلاع على قوائم الحسابات وصفحاتها: الشركات والمناديب وغيرهم.", "صارفین دیکھیں", "کمپنیوں، ڈرائیوروں اور دیگر اکاؤنٹس کی فہرستیں اور صفحات دیکھیں۔"],
  ["users.edit", "Edit users", "Suspend or reactivate accounts and change their details.", "تعديل المستخدمين", "إيقاف الحسابات أو إعادة تفعيلها وتعديل بياناتها.", "صارفین میں ترمیم", "اکاؤنٹس معطل یا دوبارہ فعال کریں اور ان کی تفصیلات بدلیں۔"],
  ["drivers.view", "View drivers", "Open the driver directory and the pages of drivers.", "عرض المناديب", "فتح دليل المناديب وصفحاتهم.", "ڈرائیور دیکھیں", "ڈرائیور ڈائریکٹری اور ڈرائیوروں کے صفحات کھولیں۔"],
  ["drivers.sensitive", "See personal data", "National ID, IBAN, full phone numbers and sign-in addresses appear unmasked.", "الاطلاع على البيانات الشخصية", "تظهر الهوية الوطنية والآيبان وأرقام الهواتف كاملة وعناوين الدخول دون إخفاء.", "ذاتی ڈیٹا دیکھیں", "قومی شناخت، IBAN، مکمل فون نمبر اور سائن اِن پتے بغیر چھپائے نظر آتے ہیں۔"],
  ["accounts.create", "Create accounts", "Add companies, courier offices and drivers on their behalf.", "إنشاء الحسابات", "إضافة شركات ومكاتب توصيل ومناديب نيابةً عنهم.", "اکاؤنٹس بنائیں", "کمپنیاں، کوریئر دفاتر اور ڈرائیور ان کی طرف سے شامل کریں۔"],
  ["accounts.edit", "Edit account details", "Change the profile, contact and bank details of any account.", "تعديل بيانات الحسابات", "تعديل الملف الشخصي وبيانات التواصل والبيانات البنكية لأي حساب.", "اکاؤنٹ کی تفصیلات بدلیں", "کسی بھی اکاؤنٹ کی پروفائل، رابطہ اور بینک تفصیلات بدلیں۔"],
  ["offices.view", "View courier offices", "Open courier offices, their drivers and their agreements.", "عرض مكاتب التوصيل", "فتح مكاتب التوصيل ومناديبها واتفاقياتها.", "کوریئر دفاتر دیکھیں", "کوریئر دفاتر، ان کے ڈرائیور اور معاہدے کھولیں۔"],
  ["offices.manage", "Manage courier offices", "Send agreements, link or unlink drivers and verify offices.", "إدارة مكاتب التوصيل", "إرسال الاتفاقيات وربط المناديب أو فصلهم وتوثيق المكاتب.", "کوریئر دفاتر منظم کریں", "معاہدے بھیجیں، ڈرائیور جوڑیں یا ہٹائیں اور دفاتر کی تصدیق کریں۔"],
  ["verification.manage", "Verify accounts", "Approve, reject or suspend drivers, companies and offices.", "توثيق الحسابات", "قبول أو رفض أو إيقاف المناديب والشركات والمكاتب.", "اکاؤنٹس کی تصدیق", "ڈرائیوروں، کمپنیوں اور دفاتر کو منظور، مسترد یا معطل کریں۔"],
  ["documents.review", "Review documents", "Approve or reject the documents people upload.", "مراجعة المستندات", "قبول أو رفض المستندات التي يرفعها المستخدمون.", "دستاویزات کا جائزہ", "لوگوں کی اپ لوڈ کی ہوئی دستاویزات منظور یا مسترد کریں۔"],
  ["requests.view", "View requests", "See delivery requests, parcels and jobs.", "عرض الطلبات", "الاطلاع على طلبات التوصيل والطرود والمهام.", "درخواستیں دیکھیں", "ڈیلیوری درخواستیں، پارسل اور جابز دیکھیں۔"],
  ["requests.edit", "Edit requests", "Change requests, parcels and their status.", "تعديل الطلبات", "تعديل الطلبات والطرود وحالتها.", "درخواستوں میں ترمیم", "درخواستیں، پارسل اور ان کی حالت بدلیں۔"],
  ["requests.assign", "Assign drivers", "Offer jobs to drivers and match requests again.", "إسناد المناديب", "عرض المهام على المناديب وإعادة مطابقة الطلبات.", "ڈرائیور مقرر کریں", "ڈرائیوروں کو جابز پیش کریں اور درخواستیں دوبارہ ملائیں۔"],
  ["attendance.edit", "Edit attendance", "Correct the arrival and attendance records of drivers.", "تعديل الحضور", "تصحيح سجلات وصول المناديب وحضورهم.", "حاضری میں ترمیم", "ڈرائیوروں کی آمد اور حاضری کے ریکارڈ درست کریں۔"],
  ["replacements.manage", "Manage replacements", "Replace a driver on a running job.", "إدارة الاستبدال", "استبدال مندوب في مهمة جارية.", "متبادل ڈرائیور منظم کریں", "جاری جاب میں ڈرائیور تبدیل کریں۔"],
  ["live_location.view", "Live map", "See where drivers are right now.", "الخريطة المباشرة", "معرفة أماكن المناديب الآن.", "لائیو نقشہ", "ڈرائیور اس وقت کہاں ہیں، یہ دیکھیں۔"],
  ["custody.view", "View custody items", "See the phones, chargers and bags handed to drivers.", "عرض العهدة", "الاطلاع على الهواتف والشواحن والحقائب المسلّمة للمناديب.", "حوالگی کی اشیاء دیکھیں", "ڈرائیوروں کو دیے گئے فون، چارجر اور بیگ دیکھیں۔"],
  ["integrations.view", "View integrations", "See warehouse-system connections and incoming orders.", "عرض الربط مع الأنظمة", "الاطلاع على اتصالات أنظمة المستودعات والطلبات الواردة.", "انٹیگریشنز دیکھیں", "ویئرہاؤس سسٹم کنکشن اور آنے والے آرڈر دیکھیں۔"],
  ["integrations.manage", "Manage integrations", "Pause, retry or change connections on a company's behalf.", "إدارة الربط مع الأنظمة", "إيقاف الاتصالات أو إعادة محاولتها أو تعديلها نيابةً عن الشركة.", "انٹیگریشنز منظم کریں", "کمپنی کی طرف سے کنکشن روکیں، دوبارہ کوشش کریں یا بدلیں۔"],
  ["tickets.view", "View support cases", "Read tickets and their conversations.", "عرض حالات الدعم", "قراءة التذاكر ومحادثاتها.", "سپورٹ کیسز دیکھیں", "ٹکٹ اور ان کی گفتگو پڑھیں۔"],
  ["tickets.manage", "Handle support cases", "Reply to, assign and resolve tickets.", "معالجة حالات الدعم", "الرد على التذاكر وإسنادها وإغلاقها.", "سپورٹ کیسز سنبھالیں", "ٹکٹوں کا جواب دیں، انہیں تفویض کریں اور حل کریں۔"],
  ["complaints.manage", "Handle complaints", "Review and resolve complaints.", "معالجة الشكاوى", "مراجعة الشكاوى وحلّها.", "شکایات سنبھالیں", "شکایات کا جائزہ لیں اور انہیں حل کریں۔"],
  ["notes.manage", "Internal notes", "Write and remove internal notes on accounts and orders.", "الملاحظات الداخلية", "كتابة الملاحظات الداخلية على الحسابات والطلبات وحذفها.", "اندرونی نوٹس", "اکاؤنٹس اور آرڈرز پر اندرونی نوٹس لکھیں اور ہٹائیں۔"],
  ["finance.view", "View finance", "Open finance overviews, prices, margins and invoices.", "عرض المالية", "فتح النظرات المالية والأسعار والهوامش والفواتير.", "مالیات دیکھیں", "مالیاتی جائزے، قیمتیں، مارجن اور انوائسز کھولیں۔"],
  ["wallets.view", "View wallets", "See wallet balances and ledgers.", "عرض المحافظ", "الاطلاع على أرصدة المحافظ وسجلاتها.", "والٹ دیکھیں", "والٹ بیلنس اور لیجر دیکھیں۔"],
  ["wallet.adjust", "Adjust wallets", "Credit or debit a wallet by hand.", "تعديل المحافظ", "إضافة مبلغ إلى محفظة أو خصمه يدويًا.", "والٹ ایڈجسٹ کریں", "والٹ میں ہاتھ سے رقم جمع یا منہا کریں۔"],
  ["settlements.review", "Review settlements", "Check settlements and put them on hold.", "مراجعة التسويات", "فحص التسويات وتعليقها.", "تصفیوں کا جائزہ", "تصفیوں کی جانچ کریں اور انہیں روکیں۔"],
  ["settlements.approve", "Approve settlements", "Approve settlements for payment.", "اعتماد التسويات", "اعتماد التسويات للدفع.", "تصفیے منظور کریں", "ادائیگی کے لیے تصفیے منظور کریں۔"],
  ["payouts.execute", "Execute payouts", "Pay out approved settlements.", "تنفيذ الدفعات", "صرف التسويات المعتمدة.", "ادائیگیاں کریں", "منظور شدہ تصفیوں کی ادائیگی کریں۔"],
  ["withdrawals.manage", "Manage withdrawals", "Approve, pay or reject withdrawal requests.", "إدارة السحوبات", "قبول طلبات السحب أو صرفها أو رفضها.", "رقم نکلوانا منظم کریں", "رقم نکلوانے کی درخواستیں منظور، ادا یا مسترد کریں۔"],
  ["cod.manage", "Manage cash on delivery", "Record cash received from drivers and follow COD balances.", "إدارة الدفع عند الاستلام", "تسجيل النقد المستلم من المناديب ومتابعة أرصدة التحصيل.", "کیش آن ڈیلیوری منظم کریں", "ڈرائیوروں سے ملنے والی نقد رقم درج کریں اور COD بیلنس دیکھیں۔"],
  ["refunds.manage", "Manage refunds", "Issue refunds and adjustments.", "إدارة المبالغ المستردة", "إصدار المبالغ المستردة والتسويات.", "ریفنڈ منظم کریں", "ریفنڈ اور ایڈجسٹمنٹ جاری کریں۔"],
  ["pricing.view", "View pricing", "See the pricing rules.", "عرض التسعير", "الاطلاع على قواعد التسعير.", "قیمتیں دیکھیں", "قیمتوں کے اصول دیکھیں۔"],
  ["pricing.edit", "Edit pricing", "Create and retire pricing rules.", "تعديل التسعير", "إنشاء قواعد التسعير وإيقافها.", "قیمتوں میں ترمیم", "قیمتوں کے اصول بنائیں اور بند کریں۔"],
  ["reports.view", "View reports", "Open analytics and reports.", "عرض التقارير", "فتح التحليلات والتقارير.", "رپورٹس دیکھیں", "تجزیات اور رپورٹس کھولیں۔"],
  ["reports.export", "Export data", "Download reports and data as files.", "تصدير البيانات", "تنزيل التقارير والبيانات كملفات.", "ڈیٹا برآمد کریں", "رپورٹس اور ڈیٹا فائل کی صورت میں ڈاؤن لوڈ کریں۔"],
  ["staff.view", "View staff and roles", "See staff accounts, roles and their permissions.", "عرض الموظفين والأدوار", "الاطلاع على حسابات الموظفين والأدوار وصلاحياتها.", "عملہ اور کردار دیکھیں", "عملے کے اکاؤنٹس، کردار اور ان کی اجازتیں دیکھیں۔"],
  ["staff.manage", "Manage staff and roles", "Create staff, change roles and permissions, reset passwords.", "إدارة الموظفين والأدوار", "إنشاء الموظفين وتعديل الأدوار والصلاحيات وإعادة تعيين كلمات المرور.", "عملہ اور کردار منظم کریں", "عملہ بنائیں، کردار اور اجازتیں بدلیں، پاس ورڈ ری سیٹ کریں۔"],
  ["settings.view", "View settings", "Open the platform settings.", "عرض الإعدادات", "فتح إعدادات المنصة.", "ترتیبات دیکھیں", "پلیٹ فارم کی ترتیبات کھولیں۔"],
  ["settings.edit", "Edit settings", "Change the platform settings.", "تعديل الإعدادات", "تغيير إعدادات المنصة.", "ترتیبات میں ترمیم", "پلیٹ فارم کی ترتیبات بدلیں۔"],
  ["audit.view", "View audit log", "Read who did what, and when.", "عرض سجل التدقيق", "قراءة من فعل ماذا ومتى.", "آڈٹ لاگ دیکھیں", "پڑھیں کہ کس نے کب کیا کیا۔"],
  ["broadcast.send", "Send announcements", "Send a message to many users at once.", "إرسال الإعلانات", "إرسال رسالة إلى عدد كبير من المستخدمين دفعة واحدة.", "اعلانات بھیجیں", "ایک ساتھ بہت سے صارفین کو پیغام بھیجیں۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(perms.flatMap((p) => [[`rjp.${p[0]}`, p[i === 1 ? 1 : i === 2 ? 3 : 5]], [`rjp.${p[0]}.d`, p[i === 1 ? 2 : i === 2 ? 4 : 6]]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
