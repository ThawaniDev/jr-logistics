"use client";
/**
 * Last-resort boundary for failures in the root layout itself (where the localized provider may not exist), so it is
 * self-contained: no app components, only inline styles, and an Arabic + English message.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, background: "#0B132B", color: "#F8FAFC", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", textAlign: "center", padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>حدث خطأ غير متوقع · Something went wrong</h1>
          <p style={{ color: "#94A3B8", marginBottom: 20 }}>حاول مرة أخرى · Please try again</p>
          <button onClick={reset} style={{ background: "#05E5A3", color: "#0B132B", border: 0, borderRadius: 12, padding: "12px 24px", fontWeight: 700, cursor: "pointer" }}>↻</button>
        </div>
      </body>
    </html>
  );
}
