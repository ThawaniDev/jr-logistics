import type { ReactNode } from "react";
import { DriverShell } from "@/components/features/admin-drivers-shell";

export default async function DriverLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverShell id={id}>{children}</DriverShell>;
}
