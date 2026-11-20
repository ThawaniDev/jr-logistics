import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/server/auth/current";
import { ChangePasswordScreen } from "@/components/auth/password-forms";

/** Every role lands here when staff gave it a temporary password; anyone signed in may also open it on purpose. */
export default async function ChangePasswordPage() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return <ChangePasswordScreen mustChange={u.mustChangePassword} home={homeFor(u.role)} />;
}
