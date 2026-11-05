import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/server/auth/current";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!u || !["admin", "staff"].includes(u.role)) redirect(u ? homeFor(u.role) : "/staff/login");
  return children;
}
