import type { Dict } from "../core";

/**
 * Platform update J, worker MA: the driver app signs in with username + password (no OTP) — login, register (live username check,
 * password checklist), the forced "choose a new password" screen and "Change password" in the profile. Every key starts with `m.au_`.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // login
  ["m.au_login_title", "Welcome back", "أهلاً بعودتك", "خوش آمدید"],
  ["m.au_login_sub", "Use the username and password of your driver account.", "استخدم اسم المستخدم وكلمة المرور الخاصين بحساب المندوب.", "اپنے ڈرائیور اکاؤنٹ کا یوزر نیم اور پاس ورڈ استعمال کریں۔"],
  ["m.au_username", "Username", "اسم المستخدم", "یوزر نیم"],
  ["m.au_password", "Password", "كلمة المرور", "پاس ورڈ"],
  ["m.au_show_password", "Show password", "إظهار كلمة المرور", "پاس ورڈ دکھائیں"],
  ["m.au_hide_password", "Hide password", "إخفاء كلمة المرور", "پاس ورڈ چھپائیں"],
  ["m.au_sign_in", "Sign in", "تسجيل الدخول", "سائن اِن"],
  ["m.au_no_account", "New to JR Logistics?", "جديد في JR Logistics؟", "JR Logistics پر نئے ہیں؟"],
  ["m.au_create_account", "Create an account", "إنشاء حساب", "اکاؤنٹ بنائیں"],
  ["m.au_have_account", "Already have an account?", "لديك حساب بالفعل؟", "پہلے سے اکاؤنٹ ہے؟"],
  ["m.au_forgot", "Forgot your password? Ask your account manager or support to reset it for you.", "نسيت كلمة المرور؟ اطلب من مدير حسابك أو الدعم إعادة تعيينها لك.", "پاس ورڈ بھول گئے؟ اپنے اکاؤنٹ مینیجر یا سپورٹ سے اسے ری سیٹ کروانے کو کہیں۔"],
  ["m.au_err_credentials", "Wrong username or password. Check them and try again.", "اسم المستخدم أو كلمة المرور غير صحيحة. تحقق منهما وحاول مرة أخرى.", "یوزر نیم یا پاس ورڈ غلط ہے۔ دوبارہ چیک کر کے کوشش کریں۔"],
  ["m.au_err_rate", "Too many attempts, or the account is temporarily locked. Wait about 15 minutes and try again.", "محاولات كثيرة أو أن الحساب مقفل مؤقتاً. انتظر نحو 15 دقيقة ثم حاول مجدداً.", "بہت زیادہ کوششیں یا اکاؤنٹ عارضی طور پر لاک ہے۔ تقریباً 15 منٹ انتظار کر کے دوبارہ کوشش کریں۔"],
  ["m.au_err_suspended", "This account is suspended. Contact support to get it back.", "هذا الحساب موقوف. تواصل مع الدعم لإعادة تفعيله.", "یہ اکاؤنٹ معطل ہے۔ اسے بحال کروانے کے لیے سپورٹ سے رابطہ کریں۔"],
  ["m.au_password_changed", "Your password was changed. Sign in with your new password.", "تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.", "آپ کا پاس ورڈ بدل دیا گیا ہے۔ نئے پاس ورڈ سے سائن اِن کریں۔"],
  // register
  ["m.au_reg_sub", "Choose a username and password, then tell us about you and your vehicle. Our team verifies your documents after sign-up.", "اختر اسم مستخدم وكلمة مرور، ثم عرّفنا بك وبمركبتك. يتحقق فريقنا من مستنداتك بعد التسجيل.", "یوزر نیم اور پاس ورڈ چنیں، پھر اپنے اور اپنی گاڑی کے بارے میں بتائیں۔ سائن اپ کے بعد ہماری ٹیم آپ کے دستاویزات کی تصدیق کرتی ہے۔"],
  ["m.au_section_account", "Your sign-in details", "بيانات الدخول", "سائن اِن کی تفصیلات"],
  ["m.au_section_you", "About you and your vehicle", "عنك وعن مركبتك", "آپ اور آپ کی گاڑی کے بارے میں"],
  ["m.au_confirm_password", "Confirm password", "تأكيد كلمة المرور", "پاس ورڈ کی تصدیق"],
  ["m.au_phone_note", "The team uses this number to contact you. No code is sent.", "يستخدم الفريق هذا الرقم للتواصل معك. لن يُرسل أي رمز.", "ٹیم اس نمبر پر آپ سے رابطہ کرتی ہے۔ کوئی کوڈ نہیں بھیجا جاتا۔"],
  ["m.au_phone_invalid", "Enter a valid mobile number (9 to 15 digits).", "أدخل رقم جوال صحيحاً (من 9 إلى 15 رقماً).", "درست موبائل نمبر درج کریں (9 سے 15 ہندسے)۔"],
  ["m.au_un_rules", "3–30 characters: lowercase letters, digits, dot, dash or underscore. Start with a letter or digit.", "من 3 إلى 30 حرفاً: أحرف لاتينية صغيرة وأرقام ونقطة وشرطة وشرطة سفلية. ابدأ بحرف أو رقم.", "3 سے 30 حروف: چھوٹے انگریزی حروف، ہندسے، نقطہ، ڈیش یا انڈر اسکور۔ حرف یا ہندسے سے شروع کریں۔"],
  ["m.au_un_checking", "Checking availability…", "جارٍ التحقق من التوفر…", "دستیابی چیک کی جا رہی ہے…"],
  ["m.au_un_ok", "Available", "متاح", "دستیاب ہے"],
  ["m.au_un_taken", "That username is already taken.", "اسم المستخدم هذا مستخدم بالفعل.", "یہ یوزر نیم پہلے سے لیا جا چکا ہے۔"],
  ["m.au_un_reserved", "That username can't be used. Choose another.", "لا يمكن استخدام اسم المستخدم هذا. اختر اسماً آخر.", "یہ یوزر نیم استعمال نہیں ہو سکتا۔ کوئی اور چنیں۔"],
  ["m.au_un_unchecked", "Couldn't check availability right now. We'll check again when you sign up.", "تعذّر التحقق من التوفر الآن. سنتحقق مجدداً عند التسجيل.", "ابھی دستیابی چیک نہیں ہو سکی۔ سائن اپ کے وقت دوبارہ چیک کریں گے۔"],
  ["m.au_pw_rules", "Your password needs:", "يجب أن تحتوي كلمة المرور على:", "آپ کے پاس ورڈ میں ہونا ضروری ہے:"],
  ["m.au_pw_len", "At least 10 characters", "10 أحرف على الأقل", "کم از کم 10 حروف"],
  ["m.au_pw_letter", "A letter (A–Z)", "حرف لاتيني واحد على الأقل (A–Z)", "ایک انگریزی حرف (A–Z)"],
  ["m.au_pw_digit", "A digit (0–9)", "رقم واحد على الأقل (0–9)", "ایک ہندسہ (0–9)"],
  ["m.au_pw_match", "Both passwords match", "كلمتا المرور متطابقتان", "دونوں پاس ورڈ ایک جیسے ہیں"],
  ["m.au_pw_mismatch", "The two passwords don't match.", "كلمتا المرور غير متطابقتين.", "دونوں پاس ورڈ ایک جیسے نہیں ہیں۔"],
  ["m.au_err_phone_taken", "An account with this mobile number already exists.", "يوجد حساب بهذا الرقم بالفعل.", "اس موبائل نمبر سے اکاؤنٹ پہلے سے موجود ہے۔"],
  ["m.au_err_email_taken", "An account with this email already exists.", "يوجد حساب بهذا البريد الإلكتروني بالفعل.", "اس ای میل سے اکاؤنٹ پہلے سے موجود ہے۔"],
  ["m.au_err_field", "Please check this field.", "يرجى مراجعة هذا الحقل.", "براہ کرم اس خانے کو چیک کریں۔"],
  // change password (forced at first sign-in, or from the profile)
  ["m.au_cp_title", "Change password", "تغيير كلمة المرور", "پاس ورڈ تبدیل کریں"],
  ["m.au_cp_forced_title", "Choose a new password", "اختر كلمة مرور جديدة", "نیا پاس ورڈ چنیں"],
  ["m.au_cp_forced_sub", "Your account uses a temporary password. Replace it with one only you know before you continue.", "يستخدم حسابك كلمة مرور مؤقتة. استبدلها بكلمة مرور لا يعرفها غيرك قبل المتابعة.", "آپ کا اکاؤنٹ عارضی پاس ورڈ استعمال کر رہا ہے۔ آگے بڑھنے سے پہلے اسے ایسے پاس ورڈ سے بدلیں جو صرف آپ کو معلوم ہو۔"],
  ["m.au_cp_sub", "Enter your current password, then choose a new one.", "أدخل كلمة المرور الحالية ثم اختر كلمة مرور جديدة.", "اپنا موجودہ پاس ورڈ درج کریں، پھر نیا چنیں۔"],
  ["m.au_cp_current", "Current password", "كلمة المرور الحالية", "موجودہ پاس ورڈ"],
  ["m.au_cp_new", "New password", "كلمة المرور الجديدة", "نیا پاس ورڈ"],
  ["m.au_cp_confirm", "Confirm new password", "تأكيد كلمة المرور الجديدة", "نئے پاس ورڈ کی تصدیق"],
  ["m.au_cp_submit", "Save new password", "حفظ كلمة المرور الجديدة", "نیا پاس ورڈ محفوظ کریں"],
  ["m.au_cp_done", "Password changed.", "تم تغيير كلمة المرور.", "پاس ورڈ بدل دیا گیا۔"],
  ["m.au_cp_wrong_current", "Your current password is incorrect.", "كلمة المرور الحالية غير صحيحة.", "آپ کا موجودہ پاس ورڈ غلط ہے۔"],
  ["m.au_cp_same", "Choose a password different from the current one.", "اختر كلمة مرور مختلفة عن الحالية.", "موجودہ پاس ورڈ سے مختلف پاس ورڈ چنیں۔"],
  // profile
  ["m.au_username_is", "Username: {name}", "اسم المستخدم: {name}", "یوزر نیم: {name}"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
