import { OfficeJobDetail } from "@/components/features/office-job-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeJobDetail id={id} />;
}
