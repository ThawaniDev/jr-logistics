import type { Dict } from "../core";

/**
 * Platform update J, worker A: everybody signs in with a username + password (no one-time-code sign-in any more) — the sign-in and registration screens, the
 * choose-a-new-password screen and the profile card, the sign-in details staff set when they create an account, and the credentials card staff use to rename an
 * account or reset its password. New keys start with `ja.`; the rows further down REPLACE older sentences that still said people sign in with a one-time code
 * (the fragments are merged over the base dictionaries). en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // ── sign in ──
  ["ja.username", "Username", "اسم المستخدم", "یوزر نیم"],
  ["ja.show", "Show", "إظهار", "دکھائیں"],
  ["ja.hide", "Hide", "إخفاء", "چھپائیں"],
  ["ja.login_forgot", "Forgot your username or password? Ask your account manager or JR support to reset it for you.", "نسيت اسم المستخدم أو كلمة المرور؟ اطلب من مدير حسابك أو من دعم JR إعادة تعيينها لك.", "یوزر نیم یا پاس ورڈ بھول گئے؟ اپنے اکاؤنٹ مینیجر یا JR سپورٹ سے اسے دوبارہ سیٹ کروائیں۔"],
  ["ja.login_new", "New to JR Logistics?", "جديد في JR Logistics؟", "JR Logistics پر نئے ہیں؟"],
  ["ja.login_create", "Create an account", "إنشاء حساب", "اکاؤنٹ بنائیں"],
  ["ja.err_invalid", "The username or password is not correct. Check them and try again.", "اسم المستخدم أو كلمة المرور غير صحيحة. تحقق منهما وحاول مرة أخرى.", "یوزر نیم یا پاس ورڈ درست نہیں۔ انہیں چیک کر کے دوبارہ کوشش کریں۔"],
  ["ja.err_locked", "Too many wrong passwords. This account is locked for 15 minutes — try again later, or ask JR support to unlock it.", "كلمات مرور خاطئة كثيرة. الحساب مقفل لمدة 15 دقيقة، حاول لاحقاً أو اطلب من دعم JR فتحه.", "بہت زیادہ غلط پاس ورڈ۔ یہ اکاؤنٹ 15 منٹ کے لیے بند ہے؛ بعد میں کوشش کریں یا JR سپورٹ سے کھلوائیں۔"],
  // ── register ──
  ["ja.reg_signin", "Your sign-in details", "بيانات تسجيل الدخول", "آپ کی لاگ اِن تفصیلات"],
  ["ja.reg_username_hint", "3–30 letters, digits, dots, dashes or underscores. You cannot change it yourself later.", "من 3 إلى 30 حرفاً أو رقماً أو نقطة أو شرطة. لا يمكنك تغييره بنفسك لاحقاً.", "3 سے 30 حروف، ہندسے، ڈاٹ، ڈیش یا انڈر اسکور۔ آپ اسے بعد میں خود نہیں بدل سکتے۔"],
  ["ja.reg_phone_hint", "A contact number for the JR team. We do not send a code to it.", "رقم تواصل لفريق JR. لن نرسل إليه أي رمز.", "JR ٹیم کے لیے رابطہ نمبر۔ ہم اس پر کوئی کوڈ نہیں بھیجتے۔"],
  ["ja.reg_have_account", "Already have an account?", "لديك حساب بالفعل؟", "پہلے سے اکاؤنٹ ہے؟"],
  ["ja.un_checking", "Checking…", "جارٍ التحقق…", "جانچ ہو رہی ہے…"],
  ["ja.un_available", "Available", "متاح", "دستیاب ہے"],
  ["ja.un_taken", "This username is already taken", "اسم المستخدم هذا مستخدم بالفعل", "یہ یوزر نیم پہلے سے استعمال میں ہے"],
  ["ja.un_reserved", "This username is reserved — choose another", "اسم المستخدم هذا محجوز، اختر اسماً آخر", "یہ یوزر نیم محفوظ ہے، کوئی اور چنیں"],
  ["ja.un_invalid", "Use 3–30 letters, digits, dots, dashes or underscores, starting with a letter or digit", "استخدم من 3 إلى 30 حرفاً أو رقماً أو نقطة أو شرطة، على أن يبدأ بحرف أو رقم", "3 سے 30 حروف، ہندسے، ڈاٹ، ڈیش یا انڈر اسکور استعمال کریں، آغاز حرف یا ہندسے سے ہو"],
  ["ja.err_username_taken", "This username is already taken", "اسم المستخدم هذا مستخدم بالفعل", "یہ یوزر نیم پہلے سے استعمال میں ہے"],
  ["ja.err_phone_taken", "An account with this mobile number already exists", "يوجد حساب بهذا الرقم بالفعل", "اس موبائل نمبر کا اکاؤنٹ پہلے سے موجود ہے"],
  ["ja.err_email_taken", "An account with this email already exists", "يوجد حساب بهذا البريد الإلكتروني بالفعل", "اس ای میل کا اکاؤنٹ پہلے سے موجود ہے"],
  ["ja.err_pw_short", "The password needs at least 10 characters", "كلمة المرور تحتاج 10 أحرف على الأقل", "پاس ورڈ کم از کم 10 حروف کا ہونا چاہیے"],
  ["ja.err_pw_weak", "The password needs at least one letter and one number", "كلمة المرور تحتاج حرفاً واحداً ورقماً واحداً على الأقل", "پاس ورڈ میں کم از کم ایک حرف اور ایک ہندسہ ہونا چاہیے"],
  ["ja.err_phone_invalid", "Enter a valid mobile number", "أدخل رقم جوال صحيحاً", "درست موبائل نمبر درج کریں"],
  // ── change password ──
  ["ja.cp_temp_title", "Choose a new password", "اختر كلمة مرور جديدة", "نیا پاس ورڈ چنیں"],
  ["ja.cp_temp_sub", "Your password was set by the JR team. Choose your own to continue.", "كلمة مرورك عيّنها فريق JR. اختر كلمة مرور خاصة بك للمتابعة.", "آپ کا پاس ورڈ JR ٹیم نے مقرر کیا تھا۔ جاری رکھنے کے لیے اپنا پاس ورڈ چنیں۔"],
  ["ja.cp_title", "Change password", "تغيير كلمة المرور", "پاس ورڈ تبدیل کریں"],
  ["ja.cp_sub", "Enter your current password and choose a new one. Your other devices are signed out.", "أدخل كلمة المرور الحالية واختر كلمة جديدة. ستُسجَّل خروجاً من أجهزتك الأخرى.", "اپنا موجودہ پاس ورڈ درج کریں اور نیا چنیں۔ آپ کے دوسرے آلات سائن آؤٹ ہو جائیں گے۔"],
  ["ja.cp_same", "The new password must be different from the current one", "يجب أن تختلف كلمة المرور الجديدة عن الحالية", "نیا پاس ورڈ موجودہ سے مختلف ہونا چاہیے"],
  ["ja.cp_wrong", "The current password is not correct", "كلمة المرور الحالية غير صحيحة", "موجودہ پاس ورڈ درست نہیں"],
  ["ja.cp_done", "Password changed", "تم تغيير كلمة المرور", "پاس ورڈ تبدیل ہو گیا"],
  ["ja.cp_card_title", "Password", "كلمة المرور", "پاس ورڈ"],
  ["ja.cp_card_sub", "The password you sign in with.", "كلمة المرور التي تسجّل بها الدخول.", "وہ پاس ورڈ جس سے آپ سائن اِن کرتے ہیں۔"],
  ["ja.cp_others_out", "After you change it, your other devices are signed out.", "بعد التغيير تُسجَّل خروجاً من أجهزتك الأخرى.", "تبدیل کرنے کے بعد آپ کے دوسرے آلات سائن آؤٹ ہو جائیں گے۔"],
  ["ja.profile_username_hint", "Your sign-in name. Only JR support can change it.", "اسم دخولك. يمكن لدعم JR فقط تغييره.", "آپ کا لاگ اِن نام۔ صرف JR سپورٹ اسے بدل سکتی ہے۔"],
  // ── staff: create an account ──
  ["ja.cf_title", "How they sign in", "كيف يسجّل الدخول", "وہ کیسے لاگ اِن کریں گے"],
  ["ja.cf_sub", "A username and a temporary password. They choose their own password the first time they sign in.", "اسم مستخدم وكلمة مرور مؤقتة. يختار الشخص كلمة مروره الخاصة عند أول دخول.", "یوزر نیم اور عارضی پاس ورڈ۔ پہلی بار لاگ اِن پر وہ اپنا پاس ورڈ خود چنتے ہیں۔"],
  ["ja.cf_username_hint", "Leave empty to use the one shown (u + the digits of the phone).", "اتركه فارغاً لاستخدام الاسم الظاهر (u + أرقام الجوال).", "خالی چھوڑیں تو دکھایا گیا نام استعمال ہوگا (u + فون کے ہندسے)۔"],
  ["ja.cf_staff_username_hint", "Leave empty to use the part of the email before the @.", "اتركه فارغاً لاستخدام الجزء الذي يسبق @ في البريد.", "خالی چھوڑیں تو ای میل کا @ سے پہلے والا حصہ استعمال ہوگا۔"],
  ["ja.cf_password", "Temporary password", "كلمة المرور المؤقتة", "عارضی پاس ورڈ"],
  ["ja.cf_password_hint", "At least 10 characters with a letter and a number. Leave empty to generate a strong one — it is shown once, after you save.", "10 أحرف على الأقل بحرف ورقم. اتركها فارغة لتوليد كلمة قوية، تظهر مرة واحدة بعد الحفظ.", "کم از کم 10 حروف، ایک حرف اور ایک ہندسے کے ساتھ۔ خالی چھوڑیں تو مضبوط پاس ورڈ بنایا جائے گا، جو محفوظ کرنے کے بعد ایک بار دکھایا جاتا ہے۔"],
  ["ja.cf_generate", "Generate a strong password", "توليد كلمة مرور قوية", "مضبوط پاس ورڈ بنائیں"],
  ["ja.cf_copy", "Copy", "نسخ", "کاپی کریں"],
  ["ja.cf_copy_both", "Copy username and password", "نسخ اسم المستخدم وكلمة المرور", "یوزر نیم اور پاس ورڈ کاپی کریں"],
  ["ja.cf_created_title", "Sign-in details to give to the person", "بيانات الدخول لتسليمها للشخص", "شخص کو دینے کے لیے لاگ اِن تفصیلات"],
  ["ja.cf_created_note", "The account was created. The person must choose a new password the first time they sign in.", "تم إنشاء الحساب. على الشخص اختيار كلمة مرور جديدة عند أول دخول.", "اکاؤنٹ بن گیا۔ پہلی بار لاگ اِن پر شخص کو نیا پاس ورڈ چننا ہوگا۔"],
  ["ja.cf_generated_note", "This password was generated for the account.", "تم توليد كلمة المرور هذه للحساب.", "یہ پاس ورڈ اس اکاؤنٹ کے لیے بنایا گیا ہے۔"],
  ["ja.cf_once", "Shown only now — copy it and give it to the person. It cannot be shown again.", "تظهر الآن فقط، انسخها وسلّمها للشخص. لا يمكن عرضها مرة أخرى.", "صرف ابھی دکھایا گیا ہے، اسے کاپی کر کے شخص کو دیں۔ دوبارہ نہیں دکھایا جا سکتا۔"],
  // ── staff: credentials card on an account ──
  ["ja.cred_title", "Sign-in details", "بيانات تسجيل الدخول", "لاگ اِن کی تفصیلات"],
  ["ja.cred_sub", "The username and password this account signs in with.", "اسم المستخدم وكلمة المرور التي يدخل بها هذا الحساب.", "وہ یوزر نیم اور پاس ورڈ جس سے یہ اکاؤنٹ لاگ اِن کرتا ہے۔"],
  ["ja.cred_change_username", "Change username", "تغيير اسم المستخدم", "یوزر نیم بدلیں"],
  ["ja.cred_reset", "Reset password", "إعادة تعيين كلمة المرور", "پاس ورڈ ری سیٹ کریں"],
  ["ja.cred_no_password", "No password set — cannot sign in yet", "لا توجد كلمة مرور، لا يمكنه الدخول بعد", "کوئی پاس ورڈ سیٹ نہیں، ابھی لاگ اِن نہیں کر سکتا"],
  ["ja.cred_must_change", "Temporary password — must choose a new one at the next sign-in", "كلمة مرور مؤقتة، يجب اختيار كلمة جديدة عند الدخول التالي", "عارضی پاس ورڈ، اگلے لاگ اِن پر نیا چننا ہوگا"],
  ["ja.cred_locked", "Locked until {when}", "مقفل حتى {when}", "{when} تک بند"],
  ["ja.cred_rename_hint", "The person keeps their session and signs in with the new username from now on.", "يحتفظ الشخص بجلسته ويسجّل الدخول باسم المستخدم الجديد من الآن.", "شخص کا سیشن برقرار رہتا ہے اور اب سے نئے یوزر نیم سے لاگ اِن کرتا ہے۔"],
  ["ja.cred_username_saved", "Username changed", "تم تغيير اسم المستخدم", "یوزر نیم بدل گیا"],
  ["ja.cred_reset_hint", "Sets a temporary password. The person is signed out everywhere and must choose a new password at the next sign-in. A locked account is unlocked.", "تعيين كلمة مرور مؤقتة. يُسجَّل الشخص خروجاً من كل مكان ويجب أن يختار كلمة جديدة عند الدخول التالي. يُفتح الحساب إن كان مقفلاً.", "عارضی پاس ورڈ مقرر ہوتا ہے۔ شخص ہر جگہ سے سائن آؤٹ ہو جاتا ہے اور اگلے لاگ اِن پر نیا پاس ورڈ چننا ہوگا۔ بند اکاؤنٹ کھل جاتا ہے۔"],
  ["ja.cred_mode_generate", "Generate a strong password", "توليد كلمة مرور قوية", "مضبوط پاس ورڈ بنائیں"],
  ["ja.cred_mode_type", "Type one myself", "أكتبها بنفسي", "خود لکھوں گا"],
  ["ja.cred_reset_done", "Password reset", "تمت إعادة تعيين كلمة المرور", "پاس ورڈ ری سیٹ ہو گیا"],
  ["ja.cred_reset_done_note", "Give these details to the person. They must choose a new password when they sign in.", "سلّم هذه البيانات للشخص. عليه اختيار كلمة مرور جديدة عند الدخول.", "یہ تفصیلات شخص کو دیں۔ لاگ اِن پر انہیں نیا پاس ورڈ چننا ہوگا۔"],

  // ── replaced sentences (no one-time-code sign-in any more) ──
  ["auth.login_title", "Sign in", "تسجيل الدخول", "سائن اِن"],
  ["auth.login_sub", "Enter your username and password.", "أدخل اسم المستخدم وكلمة المرور.", "اپنا یوزر نیم اور پاس ورڈ درج کریں۔"],
  ["auth.secure_note", "Never share your password — JR staff will never ask for it.", "لا تشارك كلمة المرور مع أحد، فريق JR لن يطلبها منك أبداً.", "اپنا پاس ورڈ کسی کو نہ بتائیں، JR عملہ کبھی اسے نہیں مانگتا۔"],
  ["auth.demo_hint", "Demo mode only. Pick an account to fill in its username and password.", "للوضع التجريبي فقط. اختر حساباً لتعبئة اسم المستخدم وكلمة المرور.", "صرف ڈیمو موڈ۔ اکاؤنٹ چنیں، اس کا یوزر نیم اور پاس ورڈ بھر جائے گا۔"],
  ["reg.sub", "Choose your username and password, then tell us about yourself.", "اختر اسم المستخدم وكلمة المرور، ثم عرّفنا بنفسك.", "اپنا یوزر نیم اور پاس ورڈ چنیں، پھر اپنے بارے میں بتائیں۔"],
  ["settings.pw_changed", "Password changed. Your other devices were signed out.", "تم تغيير كلمة المرور. سُجّل خروجك من أجهزتك الأخرى.", "پاس ورڈ تبدیل ہو گیا۔ آپ کے دوسرے آلات سائن آؤٹ ہو گئے۔"],
  ["rdb.set_pw_hint", "Your own sign-in password. Your other devices are signed out afterwards.", "كلمة مرور دخولك الشخصية. تُسجَّل أجهزتك الأخرى خروجاً بعدها.", "آپ کا اپنا لاگ اِن پاس ورڈ۔ اس کے بعد آپ کے دوسرے آلات سائن آؤٹ ہو جاتے ہیں۔"],
  ["ubz.phone_locked", "Your mobile number can only be changed by support.", "لا يمكن تغيير رقم جوالك إلا عن طريق الدعم.", "آپ کا موبائل نمبر صرف سپورٹ بدل سکتی ہے۔"],
  ["acr.add_company_sub", "Create a business account on behalf of a company. It works exactly like a self-registered one; the contact person signs in with the username and temporary password you set.", "أنشئ حساب شركة نيابةً عنها. يعمل تمامًا مثل الحساب المسجَّل ذاتيًا، ويسجّل المسؤول الدخول باسم المستخدم وكلمة المرور المؤقتة التي تحددها.", "کمپنی کی جانب سے بزنس اکاؤنٹ بنائیں۔ یہ خود رجسٹر ہونے والے اکاؤنٹ کی طرح ہی کام کرتا ہے؛ رابطہ شخص آپ کے مقرر کردہ یوزر نیم اور عارضی پاس ورڈ سے لاگ اِن کرتا ہے۔"],
  ["acr.add_office_sub", "Create a courier office account. The office signs in with the username and temporary password you set and manages its own drivers.", "أنشئ حساب مكتب توصيل. يسجّل المكتب الدخول باسم المستخدم وكلمة المرور المؤقتة التي تحددها ويدير مناديبه بنفسه.", "کوریئر دفتر کا اکاؤنٹ بنائیں۔ دفتر آپ کے مقرر کردہ یوزر نیم اور عارضی پاس ورڈ سے لاگ اِن کرتا ہے اور اپنے ڈرائیور خود سنبھالتا ہے۔"],
  ["acr.add_driver_sub", "Create a driver account with its vehicle and services. The driver signs in with the username and temporary password you set and goes online from the app.", "أنشئ حساب مندوب مع مركبته وخدماته. يسجّل المندوب الدخول باسم المستخدم وكلمة المرور المؤقتة التي تحددها ويبدأ العمل من التطبيق.", "گاڑی اور خدمات کے ساتھ ڈرائیور کا اکاؤنٹ بنائیں۔ ڈرائیور آپ کے مقرر کردہ یوزر نیم اور عارضی پاس ورڈ سے لاگ اِن کر کے ایپ سے آن لائن ہوتا ہے۔"],
  ["acr.chooser_note", "Accounts created here are recorded in the audit log under your name. Each person gets a username and a temporary password that you hand over; they choose their own at the first sign-in.", "تُسجَّل الحسابات المنشأة هنا في سجل التدقيق باسمك. يحصل كل شخص على اسم مستخدم وكلمة مرور مؤقتة تسلّمها له، ثم يختار كلمة مروره الخاصة عند أول دخول.", "یہاں بنائے گئے اکاؤنٹس آڈٹ لاگ میں آپ کے نام سے درج ہوتے ہیں۔ ہر شخص کو یوزر نیم اور عارضی پاس ورڈ ملتا ہے جو آپ اسے دیتے ہیں؛ پہلی بار لاگ اِن پر وہ اپنا پاس ورڈ خود چنتا ہے۔"],
  ["acr.card_staff_1", "Username (or email) and password sign-in (changed on first use)", "دخول باسم المستخدم (أو البريد) وكلمة مرور (تُغيَّر عند أول استخدام)", "یوزر نیم (یا ای میل) اور پاس ورڈ سے لاگ اِن (پہلی بار پر تبدیلی لازمی)"],
  ["acr.sec_holder_hint", "The person who signs in. Their mobile number is a contact number; they sign in with the username and password below.", "الشخص الذي يسجّل الدخول. رقم جواله للتواصل فقط، ويدخل باسم المستخدم وكلمة المرور أدناه.", "وہ شخص جو لاگ اِن کرتا ہے۔ اس کا موبائل نمبر رابطے کے لیے ہے؛ وہ نیچے دیے گئے یوزر نیم اور پاس ورڈ سے لاگ اِن کرتا ہے۔"],
  ["acr.sec_holder_edit", "Changing the mobile number signs the person out of all their devices; they sign in again with their username and password.", "تغيير رقم الجوال يُخرج الشخص من جميع أجهزته، ثم يدخل من جديد باسم المستخدم وكلمة المرور.", "موبائل نمبر بدلنے سے شخص اپنے تمام آلات سے سائن آؤٹ ہو جاتا ہے؛ وہ یوزر نیم اور پاس ورڈ سے دوبارہ لاگ اِن کرتا ہے۔"],
  ["acr.phone_hint", "Saudi mobile, e.g. 05XXXXXXXX. A contact number — it is not the sign-in name.", "رقم جوال سعودي، مثل 05XXXXXXXX. رقم للتواصل وليست اسم الدخول.", "سعودی موبائل، مثلاً 05XXXXXXXX۔ رابطے کا نمبر، لاگ اِن کا نام نہیں۔"],
  ["acr.will_signin", "{username} signs in with the username and temporary password you set — a new password is chosen at the first sign-in.", "يسجّل {username} الدخول باسم المستخدم وكلمة المرور المؤقتة التي تحددها، ويختار كلمة جديدة عند أول دخول.", "{username} آپ کے مقرر کردہ یوزر نیم اور عارضی پاس ورڈ سے لاگ اِن کرے گا؛ پہلی بار لاگ اِن پر نیا پاس ورڈ چنا جاتا ہے۔"],
  ["acr.will_signin_any", "The person signs in with the username and temporary password you set — a new password is chosen at the first sign-in.", "يسجّل الشخص الدخول باسم المستخدم وكلمة المرور المؤقتة التي تحددها، ويختار كلمة جديدة عند أول دخول.", "شخص آپ کے مقرر کردہ یوزر نیم اور عارضی پاس ورڈ سے لاگ اِن کرے گا؛ پہلی بار لاگ اِن پر نیا پاس ورڈ چنا جاتا ہے۔"],
  ["acr.will_no_sms", "No text message is sent — give the person the username and password yourself.", "لن تُرسل رسالة نصية، سلّم الشخص اسم المستخدم وكلمة المرور بنفسك.", "کوئی ٹیکسٹ پیغام نہیں بھیجا جائے گا؛ یوزر نیم اور پاس ورڈ شخص کو خود دیں۔"],
  ["acr.warn_phone_change", "The person is signed out of all their devices and signs in again with their username and password.", "يُخرَج الشخص من جميع أجهزته ويدخل من جديد باسم المستخدم وكلمة المرور.", "شخص اپنے تمام آلات سے سائن آؤٹ ہو جاتا ہے اور یوزر نیم اور پاس ورڈ سے دوبارہ لاگ اِن کرتا ہے۔"],
  ["acr.sms_unavailable", "No SMS service is connected — give the person the username and password yourself.", "لا توجد خدمة رسائل نصية متصلة، سلّم الشخص اسم المستخدم وكلمة المرور بنفسك.", "کوئی ایس ایم ایس سروس منسلک نہیں؛ یوزر نیم اور پاس ورڈ شخص کو خود دیں۔"],
  ["acr.sms_failed", "The text message could not be sent. The account was created — give the person the username and password yourself.", "تعذّر إرسال الرسالة النصية. تم إنشاء الحساب، سلّم الشخص اسم المستخدم وكلمة المرور بنفسك.", "ٹیکسٹ پیغام نہیں بھیجا جا سکا۔ اکاؤنٹ بن چکا ہے؛ یوزر نیم اور پاس ورڈ شخص کو خود دیں۔"],
  ["acr.sessions_ended", "The person was signed out of all their devices.", "تم إخراج الشخص من جميع أجهزته.", "شخص کو اس کے تمام آلات سے سائن آؤٹ کر دیا گیا۔"],
  ["acr.sms_welcome", "JR Logistics: an account was created for you. Sign in at {url} with the username {username} and the temporary password you were given.", "JR Logistics: تم إنشاء حساب لك. سجّل الدخول عبر {url} باسم المستخدم {username} وكلمة المرور المؤقتة التي سُلّمت لك.", "JR Logistics: آپ کے لیے اکاؤنٹ بنایا گیا ہے۔ {url} پر یوزر نیم {username} اور آپ کو دیے گئے عارضی پاس ورڈ سے لاگ اِن کریں۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
