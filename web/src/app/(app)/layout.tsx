import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { AuthProvider } from "@/components/layout/auth-context";
import { Shell } from "@/components/layout/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <AuthProvider user={user}><Shell>{children}</Shell></AuthProvider>;
}
