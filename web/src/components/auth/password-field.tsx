"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";

/** A password box with a Show / Hide button (the button is named "Show" / "Hide", never "password", so a label lookup for "Password" finds the box only). */
export function PasswordField({ label, value, onChange, error, hint, autoComplete = "current-password", placeholder, autoFocus, required, testId, extra }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; autoComplete?: "current-password" | "new-password" | "off";
  placeholder?: string; autoFocus?: boolean; required?: boolean; testId?: string; extra?: React.ReactNode;
}) {
  const t = useT(); const [shown, setShown] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(id, d) => (
        <div className="relative">
          <input id={id} aria-describedby={d} aria-invalid={!!error} required={required} autoFocus={autoFocus} data-testid={testId} dir="ltr" type={shown ? "text" : "password"} value={value} placeholder={placeholder}
            autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => onChange(e.target.value)}
            className={cn("h-10 w-full rounded-xl border border-line bg-bg2 ps-3 text-start text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 aria-[invalid=true]:border-danger", extra ? "pe-28" : "pe-16")} />
          <div className="absolute inset-y-0 end-1 flex items-center gap-0.5">
            {extra}
            <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-label={t(shown ? "ja.hide" : "ja.show")} title={t(shown ? "ja.hide" : "ja.show")}
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-ink pointer-coarse:size-10" data-testid={testId ? `${testId}-toggle` : undefined}>
              {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}
