import { OfficeDriverDetail } from "@/components/features/office-driver-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeDriverDetail id={id} />;
}
