/** Money helpers. Everything internal is integer halalas. */
export const toCents = (sar: number): number => Math.round(sar * 100);
export const fromCents = (cents: number): number => cents / 100;
export const fmtSar = (cents: number, locale = "en"): string =>
  new Intl.NumberFormat(locale === "ar" || locale === "ur" ? "ar-SA-u-nu-latn" : "en-SA", {
    style: "currency", currency: "SAR", minimumFractionDigits: 2,
  }).format(cents / 100);

/** Round a percentage of cents half-up deterministically. */
export const pct = (cents: number, percent: number): number => Math.round((cents * percent) / 100);
