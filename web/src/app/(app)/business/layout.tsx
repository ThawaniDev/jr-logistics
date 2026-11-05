import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/server/auth/current";

export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!u || u.role !== "business") redirect(u ? homeFor(u.role) : "/login");
  return children;
}
