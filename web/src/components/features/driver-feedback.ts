/**
 * Sound and haptics for the driver screens (scan accepted / rejected, new offer). Browser only; every call is best effort and silent on failure.
 * Browsers start an AudioContext "suspended" until the user has touched the page, so the context is created lazily and resumed on the first tap/key.
 */
export type Tone = "ok" | "warn" | "error" | "alert";

let ctx: AudioContext | null = null;
let unlockBound = false;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    return ctx;
  } catch { return null; }
}

/** Call once from a mounted component: the first user gesture resumes audio so later beeps (e.g. a poll result) are allowed to play. */
export function unlockAudio() {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;
  const resume = () => {
    const c = audioCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    if (c && c.state === "running") { window.removeEventListener("pointerdown", resume); window.removeEventListener("keydown", resume); unlockBound = false; }
  };
  window.addEventListener("pointerdown", resume); window.addEventListener("keydown", resume);
}

const PATTERNS: Record<Tone, Array<{ f: number; ms: number; gap?: number }>> = {
  ok: [{ f: 1568, ms: 90 }],
  warn: [{ f: 880, ms: 110 }],
  error: [{ f: 330, ms: 140, gap: 70 }, { f: 262, ms: 220 }],
  alert: [{ f: 988, ms: 130, gap: 60 }, { f: 1319, ms: 130, gap: 60 }, { f: 1568, ms: 200 }],
};
const BUZZ: Record<Tone, number | number[]> = { ok: 40, warn: [30, 40, 30], error: [90, 60, 90], alert: [120, 80, 120, 80, 200] };

/** Short beep through WebAudio. Returns false when the browser blocked it (no gesture yet) so callers may fall back to a vibration or just the toast. */
export function beep(tone: Tone = "ok"): boolean {
  const c = audioCtx();
  if (!c) return false;
  try {
    if (c.state === "suspended") { void c.resume().catch(() => {}); if (c.state === "suspended") return false; }
    let t = c.currentTime;
    for (const p of PATTERNS[tone]) {
      const osc = c.createOscillator(); const gain = c.createGain();
      osc.type = "square"; osc.frequency.value = p.f;
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, t + p.ms / 1000);
      osc.connect(gain).connect(c.destination); osc.start(t); osc.stop(t + p.ms / 1000 + 0.02);
      t += (p.ms + (p.gap ?? 0)) / 1000;
    }
    return true;
  } catch { return false; }
}

export function buzz(tone: Tone = "ok") {
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(BUZZ[tone]); } catch { /* not supported */ }
}

/** Beep + vibrate. */
export function signal(tone: Tone = "ok") { beep(tone); buzz(tone); }
