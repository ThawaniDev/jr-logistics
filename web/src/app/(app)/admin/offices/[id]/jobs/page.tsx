import { OfficeJobsTab } from "@/components/features/admin-offices-jobs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeJobsTab id={id} />;
}
