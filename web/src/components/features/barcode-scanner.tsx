"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Flashlight, FlashlightOff, ScanLine, X } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { BARCODE_FORMATS, createDeduper, normalizeScanCode } from "./driver-fieldops-utils";
import { signal } from "./driver-feedback";
import { Sheet, fieldCls } from "./driver-stops-shared";

/** What the host says about a code the camera just read: shown over the video (and beeped) in continuous mode. */
export interface ScanFeedback { kind: "ok" | "warn" | "error"; text: string }
type DetectResult = void | ScanFeedback | Promise<void | ScanFeedback>;
type CamError = "insecure" | "unsupported" | "denied" | "none" | "busy" | "failed";

/** Reads one frame at a time. Native `BarcodeDetector` when the browser has it, otherwise @zxing (loaded only then). */
async function makeDecoder(video: HTMLVideoElement): Promise<() => Promise<string | null>> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o?: { formats: string[] }): { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (BD) {
    try {
      let formats: string[] = [...BARCODE_FORMATS];
      if (typeof BD.getSupportedFormats === "function") { const ok = await BD.getSupportedFormats(); formats = formats.filter((f) => ok.includes(f)); }
      if (formats.length) { const det = new BD({ formats }); return async () => (await det.detect(video))[0]?.rawValue ?? null; }
    } catch { /* an unusable native detector falls through to zxing */ }
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map<import("@zxing/library").DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d", { willReadFrequently: true });
  return async () => {
    const w = video.videoWidth; const h = video.videoHeight;
    if (!g || !w || !h) return null;
    const k = Math.min(1, 960 / w); canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { return null; } // NotFoundException = nothing readable in this frame
  };
}

const camErrorOf = (e: unknown): CamError => {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "none";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
};

const SCANLINE_CSS = "@keyframes jr-scanline{0%{top:4%}50%{top:94%}100%{top:4%}}.jr-scanline{animation:jr-scanline 2.2s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.jr-scanline{animation:none;top:50%}}";

/**
 * Live camera preview that reads barcodes / QR codes. Back camera, torch toggle when the device has one, scan-line overlay, repeated reads of the
 * same label collapse into one. The stream is always stopped on unmount. `continuous` keeps reading after each accepted code (loading screen);
 * otherwise the first code ends the session (`onClose` is called after `onDetect`).
 */
export function BarcodeScanner({ onDetect, continuous = false, onClose, className }: { onDetect: (code: string) => DetectResult; continuous?: boolean; onClose?: () => void; className?: string }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const handler = useRef(onDetect); const closer = useRef(onClose);
  useEffect(() => { handler.current = onDetect; closer.current = onClose; });
  const [live, setLive] = useState(false);
  const [error, setError] = useState<CamError | null>(null);
  const [torchOk, setTorchOk] = useState(false); const [torchOn, setTorchOn] = useState(false);
  const [flash, setFlash] = useState<ScanFeedback | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false; let stream: MediaStream | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let flashTimer: ReturnType<typeof setTimeout> | undefined;
    let pausedUntil = 0; let reading = false;
    const dedupe = createDeduper(continuous ? 3000 : 1500);
    const video = videoRef.current;
    const fail = (e: CamError) => { if (!cancelled) setError(e); };
    const release = () => { stream?.getTracks().forEach((tr) => tr.stop()); stream = null; trackRef.current = null; if (video) { video.pause(); video.srcObject = null; } };

    async function onCode(raw: string) {
      const code = normalizeScanCode(raw);
      if (!code || !dedupe.accept(code)) return;
      pausedUntil = Date.now() + 900; // let the driver move the camera to the next label
      let fb: ScanFeedback = { kind: "ok", text: code };
      try { const r = await handler.current(code); if (r) fb = r; } catch { fb = { kind: "error", text: code }; }
      signal(fb.kind === "ok" ? "ok" : fb.kind === "warn" ? "warn" : "error");
      if (cancelled) return;
      if (continuous) { setFlash(fb); clearTimeout(flashTimer); flashTimer = setTimeout(() => setFlash(null), 1600); if (fb.kind === "error") dedupe.reset(); /* a rejected code may be scanned again after a fix */ }
      else if (fb.kind === "ok") closer.current?.();
    }

    (async () => {
      if (!window.isSecureContext) return fail("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return fail("unsupported");
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch (e) { return fail(camErrorOf(e)); }
      if (cancelled || !video) { release(); return; }
      const track = stream.getVideoTracks()[0]; trackRef.current = track ?? null;
      try { setTorchOk(!!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch); } catch { /* capabilities not supported */ }
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay can be refused until a tap; the muted inline video normally starts */ }
      let read: () => Promise<string | null>;
      try { read = await makeDecoder(video); } catch { release(); return fail("failed"); }
      if (cancelled) { release(); return; }
      setLive(true);
      const tick = () => {
        if (cancelled) return;
        timer = setTimeout(async () => {
          if (cancelled) return;
          if (!reading && Date.now() >= pausedUntil && video.readyState >= 2) {
            reading = true;
            try { const raw = await read(); if (raw) await onCode(raw); } catch { /* a frame that cannot be read is skipped */ } finally { reading = false; }
          }
          tick();
        }, 150);
      };
      tick();
    })();

    return () => { cancelled = true; clearTimeout(timer); clearTimeout(flashTimer); release(); };
  }, [continuous, attempt]);

  async function toggleTorch() {
    const tr = trackRef.current; if (!tr) return;
    const next = !torchOn;
    try { await tr.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorchOn(next); } catch { setTorchOk(false); }
  }

  if (error) {
    return (
      <div className={cn("space-y-3", className)} data-testid="scanner-error" data-reason={error}>
        <Notice tone="warn">{t(`fod.cam_${error}`)}</Notice>
        <div className="grid grid-cols-2 gap-2">
          {error !== "insecure" && error !== "unsupported" && <Button type="button" variant="secondary" size="lg" onClick={() => { setError(null); setLive(false); setAttempt((n) => n + 1); }}>{t("common.retry")}</Button>}
          <Button type="button" variant="primary" size="lg" className={error === "insecure" || error === "unsupported" ? "col-span-2" : ""} onClick={() => closer.current?.()}>{t("fod.cam_type_instead")}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", className)} data-testid="scanner" data-live={live ? "1" : "0"}>
      <style>{SCANLINE_CSS}</style>
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} muted playsInline autoPlay aria-label={t("dstop.scan_title")} className="aspect-[4/3] max-h-[60dvh] w-full object-cover" />
        <div aria-hidden className="pointer-events-none absolute inset-x-8 inset-y-6 rounded-xl border-2 border-accent/70">
          <div className="jr-scanline absolute inset-x-1 h-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--jr-accent)]" />
        </div>
        {!live && <p role="status" className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-white">{t("fod.cam_starting")}</p>}
        <div className="absolute end-2 top-2 flex gap-2">
          {torchOk && <button type="button" data-testid="scan-torch" aria-pressed={torchOn} aria-label={t(torchOn ? "fod.cam_torch_off" : "fod.cam_torch_on")} onClick={toggleTorch} className="jr-tap flex size-11 items-center justify-center rounded-full bg-black/60 text-white">{torchOn ? <FlashlightOff className="size-5" aria-hidden /> : <Flashlight className="size-5" aria-hidden />}</button>}
          {continuous && onClose && <button type="button" data-testid="scan-camera-close" aria-label={t("fod.cam_close")} onClick={onClose} className="jr-tap flex size-11 items-center justify-center rounded-full bg-black/60 text-white"><X className="size-5" aria-hidden /></button>}
        </div>
        {flash && (
          <p role="status" data-testid="scan-flash" data-kind={flash.kind} className={cn("absolute inset-x-3 bottom-3 truncate rounded-xl px-3 py-2 text-center text-base font-bold", flash.kind === "ok" ? "bg-accent text-accent-ink" : flash.kind === "warn" ? "bg-gold text-black" : "bg-danger text-black")}>{flash.text}</p>
        )}
      </div>
      <p className="text-sm text-muted">{t("fod.cam_hint")}</p>
    </div>
  );
}

const noop = () => () => {};
/** The camera button is shown on every client (a tap on a device without camera access explains why); never during server rendering. */
function useClientOnly() { return useSyncExternalStore(noop, () => true, () => false); }

export interface ScanInputProps {
  value: string; onChange: (v: string) => void;
  label?: string; hint?: string; error?: string; required?: boolean; disabled?: boolean; placeholder?: string; autoFocus?: boolean;
  /** Called with a code read by the camera (after it was put into the field). In `continuous` mode the returned feedback is shown over the video. */
  onScan?: (code: string) => DetectResult;
  /** Enter key + an inline submit button. */
  onSubmit?: (code: string) => void;
  /** Enter key only (no button): e.g. a hardware scanner "types" the code and presses Enter — the host decides what happens next. */
  onEnter?: (code: string) => void;
  submitLabel?: ReactNode; submitting?: boolean;
  /** Keep the camera open after each accepted code (loading screen). */
  continuous?: boolean;
  /** Put a scanned code into the field (default). The loading screen turns this off: every code is submitted at once. */
  fillOnScan?: boolean;
  testId?: string; cameraTestId?: string; submitTestId?: string;
  sheetTitle?: string; inputClassName?: string; inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * A shipment-number field: type or paste the code, or tap the camera button to scan it. Manual typing always works — if the camera is
 * unavailable (denied, no camera, no https) the scanner says why and returns to the field.
 */
export function ScanInput({ value, onChange, label, hint, error, required, disabled, placeholder, autoFocus, onScan, onSubmit, onEnter, submitLabel, submitting, continuous = false, fillOnScan = true, testId = "scan-input", cameraTestId = "scan-camera", submitTestId = "scan-submit", sheetTitle, inputClassName, inputRef }: ScanInputProps) {
  const { t } = useI18n();
  const client = useClientOnly();
  const [open, setOpen] = useState(false);
  const detected = (code: string) => { if (fillOnScan) onChange(code); return onScan?.(code); };
  return (
    <div className="space-y-3">
      <Field label={label} error={error} hint={hint} required={required}>
        {(id, d) => (
          <div className="flex gap-2">
            <input ref={inputRef} id={id} data-testid={testId} aria-describedby={d} aria-invalid={!!error} dir="ltr" value={value} disabled={disabled} placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { const go = onEnter ?? onSubmit; if (e.key === "Enter" && go) { e.preventDefault(); go(normalizeScanCode(value)); } }}
              autoFocus={autoFocus} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint={onSubmit || onEnter ? "done" : "next"}
              className={cn(fieldCls, "h-14 min-w-0 flex-1 text-start font-mono text-lg uppercase tracking-wide", inputClassName)} />
            {onSubmit && <Button type="button" data-testid={submitTestId} size="lg" className="h-14 shrink-0 px-5 text-base" loading={submitting} disabled={disabled || !value.trim()} onClick={() => onSubmit(normalizeScanCode(value))}>{submitLabel ?? t("common.confirm")}</Button>}
            {client && <Button type="button" data-testid={cameraTestId} aria-expanded={open} aria-label={t("dstop.scan")} variant="secondary" disabled={disabled} className="h-14 shrink-0 px-4 text-base" onClick={() => setOpen((o) => !o)}><ScanLine className="size-5" aria-hidden /><span className="max-sm:sr-only">{t("dstop.scan")}</span></Button>}
          </div>
        )}
      </Field>
      {continuous
        ? open && <BarcodeScanner continuous onDetect={detected} onClose={() => setOpen(false)} />
        : <Sheet open={open} onClose={() => setOpen(false)} title={sheetTitle ?? t("dstop.scan_title")}><BarcodeScanner onDetect={detected} onClose={() => setOpen(false)} /></Sheet>}
    </div>
  );
}
