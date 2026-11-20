import { redirect } from "next/navigation";

/** Everybody signs in on `/login` now (username + password, staff included). Old links and bookmarks land there. */
export default async function StaffLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  redirect(sp.expired ? "/login?expired=1" : "/login");
}
