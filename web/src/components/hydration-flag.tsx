"use client";
import { useEffect } from "react";

/** Marks the document once React has hydrated, so E2E tests (and any monitoring) can wait for interactivity deterministically. */
export function HydrationFlag() {
  useEffect(() => { document.documentElement.dataset.hydrated = "true"; }, []);
  return null;
}
