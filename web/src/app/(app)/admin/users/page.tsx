import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { UsersList } from "@/components/features/admin-users-list";

export default function AdminUsers() {
  return <Suspense fallback={<PageLoading />}><UsersList /></Suspense>;
}
