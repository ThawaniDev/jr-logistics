import type { Dict } from "../core";

/**
 * Platform update J, worker D — drivers of an office (no earnings, no wallet; the cash stays visible, J4) and the stat cards on every order card (J5).
 * Every key starts with `jd.` (plus the `err.WALLET_MANAGED_BY_OFFICE` error text). en, ar and ur are built from the same rows.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  // the wallet page of an office driver
  ["jd.nav_wallet_cash", "Wallet & cash", "المحفظة والنقد", "والٹ اور نقد"],
  ["jd.wallet_sub", "Your office manages your wallet. The cash you collect from customers stays visible here.", "مكتبك هو من يدير محفظتك. يبقى النقد الذي تحصّله من العملاء ظاهرًا لك هنا.", "آپ کا دفتر آپ کا والٹ سنبھالتا ہے۔ گاہکوں سے وصول کیا گیا نقد یہاں نظر آتا رہتا ہے۔"],
  ["jd.managed_title", "Your wallet is managed by your office", "محفظتك يديرها مكتبك", "آپ کا والٹ آپ کا دفتر سنبھالتا ہے"],
  ["jd.managed_body", "Your office receives the payment for your jobs and handles your payouts, so there is no balance or earnings to show here.", "يستلم مكتبك مقابل مهامك ويتولى دفعاتك، لذلك لا يوجد رصيد أو أرباح لعرضها هنا.", "آپ کا دفتر آپ کے کاموں کی ادائیگی وصول کرتا ہے اور آپ کی نکلوائی خود سنبھالتا ہے، اس لیے یہاں دکھانے کو بیلنس یا کمائی نہیں۔"],
  ["jd.managed_hint", "Questions about your pay or payouts? Ask your office.", "للاستفسار عن أجرك أو دفعاتك، اسأل مكتبك.", "اپنی ادائیگی یا نکلوائی کے بارے میں اپنے دفتر سے پوچھیں۔"],
  ["jd.your_office", "your office", "مكتبك", "آپ کا دفتر"],
  ["jd.office_label", "Office", "المكتب", "دفتر"],
  ["jd.cash_title", "Cash with you", "النقد الذي معك", "آپ کے پاس نقد"],
  ["jd.cash_sub", "Cash on delivery you collected and what you handed over to the warehouse.", "النقد عند التسليم الذي حصّلته وما سلّمته للمستودع.", "ڈیلیوری پر وصول کیا گیا نقد اور جو آپ نے گودام کو دیا۔"],
  ["jd.cash_open", "Open cash details", "فتح تفاصيل النقد", "نقد کی تفصیل کھولیں"],
  ["err.WALLET_MANAGED_BY_OFFICE", "Your wallet is managed by your office, so payouts are handled by them.", "محفظتك يديرها مكتبك، لذلك يتولى المكتب الدفعات.", "آپ کا والٹ آپ کا دفتر سنبھالتا ہے، اس لیے نکلوائی وہی کرتا ہے۔"],
  // dashboard, profile, job screens
  ["jd.dash_wallet", "Wallet", "المحفظة", "والٹ"],
  ["jd.dash_wallet_hint", "Managed by your office", "يديرها مكتبك", "آپ کا دفتر سنبھالتا ہے"],
  ["jd.linked_note", "You are linked to {office}. Your office manages your wallet and payouts; you still see the cash you collect.", "أنت مرتبط بـ {office}. يدير مكتبك محفظتك ودفعاتك، وتبقى ترى النقد الذي تحصّله.", "آپ {office} سے منسلک ہیں۔ آپ کا دفتر آپ کا والٹ اور نکلوائی سنبھالتا ہے؛ آپ وصول کیا گیا نقد پھر بھی دیکھتے ہیں۔"],
  ["jd.hint_completed_office", "Completed. Your office handles the payment.", "اكتملت. يتولى مكتبك الدفع.", "مکمل۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["jd.job_completed_office", "The job is complete. Your office handles the payment.", "اكتملت المهمة. يتولى مكتبك الدفع.", "کام مکمل ہو گیا۔ ادائیگی آپ کا دفتر سنبھالتا ہے۔"],
  ["jd.finish_hint_office", "Finish the route. The job completes at once.", "أنهِ المسار. تكتمل المهمة فورًا.", "روٹ مکمل کریں۔ کام فوراً مکمل ہو جاتا ہے۔"],
  ["jd.finish_ok_office", "Route finished — the job is complete.", "تم إنهاء المسار — اكتملت المهمة.", "روٹ مکمل — کام مکمل ہو گیا۔"],
  // stat cards on the order cards (J5)
  ["jd.stat_expected", "Up to this many parcels. The exact share is set when you accept.", "حتى هذا العدد من الطرود. تُحدَّد حصتك بدقة عند القبول.", "زیادہ سے زیادہ اتنے پارسل۔ قبول کرنے پر آپ کا درست حصہ طے ہوتا ہے۔"],
  ["jd.stat_failed", "Failed", "فشل التسليم", "ناکام"],
  ["jd.stat_returned", "Returned", "مرتجعة", "واپس"],
  ["jd.stat_cod_handed", "Cash handed over", "نقد سُلِّم", "جمع کرایا گیا نقد"],
  ["jd.stat_cod_open", "{amount} still with you", "{amount} ما زال معك", "{amount} ابھی آپ کے پاس"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
export const JD_ROWS = rows;
