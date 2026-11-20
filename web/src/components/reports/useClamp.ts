"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Keeps an absolutely positioned popover inside the viewport horizontally (LTR and RTL, any trigger position): returns a ref for the panel and the pixel shift
 * to apply (`style={{ transform: translateX(shift) }}`). Re-measures whenever `open` turns on.
 */
export function useClampX<T extends HTMLElement>(open: boolean, margin = 8) {
  const ref = useRef<T>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) { setShift(0); return; }
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const left = r.left - shift, right = r.right - shift;
    let s = 0;
    if (right > vw - margin) s = vw - margin - right;
    if (left + s < margin) s = margin - left;
    if (s !== shift) setShift(s);
  }, [open, margin, shift]);
  return { ref, shift };
}
