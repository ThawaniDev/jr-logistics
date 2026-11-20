import { redirect } from "next/navigation";

/** The temporary-password screen is one for every role now: `/account/change-password` (this address keeps working). */
export default function StaffChangePassword() { redirect("/account/change-password"); }
