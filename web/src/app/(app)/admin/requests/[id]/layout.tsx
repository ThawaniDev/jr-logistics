import type { ReactNode } from "react";
import { OrderShell } from "@/components/features/admin-order-shell";

export default async function OrderLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderShell id={id}>{children}</OrderShell>;
}
