import { DriverDocumentsTab } from "@/components/features/admin-drivers-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverDocumentsTab id={id} />;
}
