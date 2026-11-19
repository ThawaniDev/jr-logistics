import { OfficeDriversTab } from "@/components/features/admin-offices-drivers";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeDriversTab id={id} />;
}
