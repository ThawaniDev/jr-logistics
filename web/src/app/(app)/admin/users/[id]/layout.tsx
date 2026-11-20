import type { ReactNode } from "react";
import { UserShell } from "@/components/features/admin-user-detail-shell";

export default async function UserLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserShell id={id}>{children}</UserShell>;
}
