import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { getSettings } from "@/server/settings";
import { AuthProvider } from "@/components/layout/auth-context";
import { Shell } from "@/components/layout/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // Signed-out visitors are redirected by each role layout, so staff land on the staff sign-in and everyone else on the customer one.
  if (!user) return <>{children}</>;
  const backoffice = user.role === "admin" || user.role === "staff";
  if (user.mustChangePassword) redirect("/account/change-password"); // a temporary password (set by staff) must be replaced first — every role
  if (backoffice && !user.mfaEnabled && (await getSettings()).requireStaffMfa) redirect("/staff/mfa");
  return <AuthProvider user={user}><Shell>{children}</Shell></AuthProvider>;
}
