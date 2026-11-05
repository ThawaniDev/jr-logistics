/** Normalise Saudi/E.164 phone numbers to +<digits>. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  let s = (input ?? "").replace(/[\s\-().]/g, "");
  // Arabic-Indic digits → latin
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^05\d{8}$/.test(s)) return "+966" + s.slice(1);
  if (/^5\d{8}$/.test(s)) return "+966" + s;
  if (/^9665\d{8}$/.test(s)) return "+" + s;
  if (/^\+9665\d{8}$/.test(s)) return s;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s; // other international numbers
  return null;
}

/** wa.me wants digits only, no plus. */
export const waNumber = (phone: string) => phone.replace(/\D/g, "");
