"use client";
import { useEffect } from "react";
import { THEME_COOKIE, parseThemeMode } from "@/lib/theme";

/**
 * Last-resort boundary for failures in the root layout itself (where the localized provider and the design-token stylesheet may not exist), so it is
 * self-contained: no app components, an inline stylesheet with the same two palettes as globals.css (dark by default, light when the visitor chose Light or
 * follows a light OS — the cookie is read after mount), and an Arabic + English message.
 */
const CSS = `
:root{--bg:#0b132b;--ink:#f8fafc;--muted:#94a3b8;--accent:#05e5a3;--on-accent:#0b132b;color-scheme:dark}
:root[data-t="light"]{--bg:#f6f8fb;--ink:#0f172a;--muted:#424e61;--accent:#046d4f;--on-accent:#ffffff;color-scheme:light}
@media (prefers-color-scheme:light){:root[data-t="system"]{--bg:#f6f8fb;--ink:#0f172a;--muted:#424e61;--accent:#046d4f;--on-accent:#ffffff;color-scheme:light}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100dvh;text-align:center;padding:24px}
h1{font-size:24px;margin-bottom:8px}p{color:var(--muted);margin-bottom:20px}
button{background:var(--accent);color:var(--on-accent);border:0;border-radius:12px;padding:12px 24px;font-weight:700;cursor:pointer}`;

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(\\w+)`));
    document.documentElement.dataset.t = parseThemeMode(m?.[1]);
  }, []);
  return (
    <html lang="ar" dir="rtl" data-t="system" suppressHydrationWarning>
      <head><style>{CSS}</style></head>
      <body>
        <div>
          <h1>حدث خطأ غير متوقع · Something went wrong</h1>
          <p>حاول مرة أخرى · Please try again</p>
          <button onClick={reset}>↻</button>
        </div>
      </body>
    </html>
  );
}
