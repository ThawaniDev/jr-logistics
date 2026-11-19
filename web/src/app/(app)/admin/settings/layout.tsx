"use client";
import { Suspense, type ReactNode } from "react";
import { PageLoading } from "@/components/ui";
import { SettingsShell } from "@/components/features/admin-system-settings";

/** Shared frame of /admin/settings/*: title, route-based tabs and the settings state (edits survive moving between tabs). */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}><SettingsShell>{children}</SettingsShell></Suspense>;
}
