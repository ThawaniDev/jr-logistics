import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/server/auth/current";
import { OfflineBanner } from "@/components/features/driver-offline";
import { DriverAlerts } from "@/components/features/driver-alerts";

export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!u || u.role !== "driver") redirect(u ? homeFor(u.role) : "/login");
  return <><OfflineBanner /><DriverAlerts />{children}</>;
}
