import type { ReactNode } from "react";
import { CompanyShell } from "@/components/features/admin-companies-shell";

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyShell id={id}>{children}</CompanyShell>;
}
