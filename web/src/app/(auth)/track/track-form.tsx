"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useT } from "@/i18n/provider";

/** What recipients paste or type: spaces and case never matter (the server matches case-insensitively). */
const norm = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/** Parcel code + last 4 digits of the recipient's phone → /track/<code>?p=<digits>. No account needed. */
export function TrackForm({ initialCode = "", initialDigits = "", error }: { initialCode?: string; initialDigits?: string; error?: string }) {
  const t = useT(); const router = useRouter();
  const [code, setCode] = useState(initialCode); const [digits, setDigits] = useState(initialDigits); const [touched, setTouched] = useState(false);
  const codeOk = norm(code).length >= 3; const digitsOk = /^\d{4}$/.test(digits);
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (codeOk && digitsOk) router.push(`/track/${encodeURIComponent(norm(code))}?p=${digits}`); }}>
      <Input label={t("bs.track_code")} ltr value={code} onChange={(e) => setCode(e.target.value)} placeholder="JR-000012-007" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next" maxLength={40} className="h-12 text-base" error={touched && !codeOk ? t("val.required") : undefined} required />
      <Input label={t("bs.track_digits")} ltr inputMode="numeric" pattern="[0-9]*" enterKeyHint="search" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" autoComplete="off" className="h-12 text-base" hint={t("bs.track_digits_hint")} maxLength={4} error={touched && !digitsOk ? t("bs.track_digits_bad") : error} required />
      <Button type="submit" full size="lg" className="h-14 text-base"><Search className="size-4" aria-hidden />{t("bs.track_submit")}</Button>
    </form>
  );
}
