"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Field } from "@/components/ui";
import { get } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usernameProblem, normalizeUsername } from "@/lib/username";
import { useT } from "@/i18n/provider";

export type UsernameState = "idle" | "checking" | "available" | "taken" | "invalid" | "reserved" | "error";

/** Live check of a username: the format rules instantly (same rules as the server), then — after a short pause — whether it is free. `skip` = do not ask the server (an unchanged name, an empty optional box). */
export function useUsernameCheck(raw: string, o: { skip?: boolean; delay?: number } = {}): UsernameState {
  const [res, setRes] = useState<{ q: string; s: UsernameState } | null>(null);
  const u = normalizeUsername(raw);
  const local = !u ? "idle" : usernameProblem(u);
  const needsServer = !o.skip && !!u && !local;
  useEffect(() => {
    if (!needsServer) return;
    let live = true;
    const h = setTimeout(() => {
      get<{ available: boolean; reason?: string }>(`/auth/username-available?username=${encodeURIComponent(u)}`)
        .then((r) => { if (live) setRes({ q: u, s: r.available ? "available" : r.reason === "reserved" ? "reserved" : r.reason === "invalid" ? "invalid" : "taken" }); })
        .catch(() => { if (live) setRes({ q: u, s: "error" }); });
    }, o.delay ?? 400);
    return () => { live = false; clearTimeout(h); };
  }, [u, needsServer, o.delay]);
  if (!u) return "idle";
  if (local) return local;
  if (o.skip) return "idle";
  return res?.q === u ? res.s : "checking";
}

const TONE: Record<UsernameState, string> = { idle: "text-muted", checking: "text-muted", available: "text-accent", taken: "text-danger", invalid: "text-danger", reserved: "text-danger", error: "text-muted" };

/** The username box with its live status line (Available / Already taken / format hint). `state` comes from `useUsernameCheck`; `error` is a server message that wins. */
export function UsernameField({ label, value, onChange, state, error, hint, required, autoFocus, testId = "reg-username", placeholder, autoComplete = "username" }: {
  label: string; value: string; onChange: (v: string) => void; state: UsernameState; error?: string; hint?: string; required?: boolean; autoFocus?: boolean; testId?: string; placeholder?: string; autoComplete?: "username" | "off";
}) {
  const t = useT();
  const msg = state === "checking" ? t("ja.un_checking") : state === "available" ? t("ja.un_available") : state === "taken" ? t("ja.un_taken") : state === "reserved" ? t("ja.un_reserved") : state === "invalid" ? t("ja.un_invalid") : null;
  const bad = state === "taken" || state === "invalid" || state === "reserved";
  return (
    <Field label={label} error={error ?? (bad && msg ? msg : undefined)} hint={hint} required={required}>
      {(id, d) => (
        <>
          <input id={id} aria-describedby={d} aria-invalid={!!error || bad} required={required} autoFocus={autoFocus} data-testid={testId} dir="ltr" value={value} placeholder={placeholder} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" maxLength={60}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full rounded-xl border border-line-strong bg-bg2 px-3 text-start text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 aria-[invalid=true]:border-danger" />
          {!error && !bad && msg && (
            <p role="status" data-testid={`${testId}-status`} className={cn("flex items-center gap-1.5 text-xs", TONE[state])}>
              {state === "checking" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : state === "available" ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}{msg}
            </p>
          )}
        </>
      )}
    </Field>
  );
}
