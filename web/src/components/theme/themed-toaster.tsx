"use client";
import { Toaster } from "sonner";
import { useTheme } from "./theme-provider";

/** The toast stack follows the active theme (its colours come from the design tokens; sonner's own `theme` only drives its status icons). */
export function ThemedToaster({ dir }: { dir: "ltr" | "rtl" }) {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} toastOptions={{ style: { background: "var(--jr-card)", border: "1px solid var(--jr-line)", color: "var(--jr-text)" } }} />;
}
