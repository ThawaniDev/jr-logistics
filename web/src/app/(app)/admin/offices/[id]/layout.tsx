import type { ReactNode } from "react";
import { OfficeShell } from "@/components/features/admin-offices-shell";

export default async function OfficeLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeShell id={id}>{children}</OfficeShell>;
}
