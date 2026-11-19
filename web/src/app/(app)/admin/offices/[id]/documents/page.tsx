import { OfficeDocumentsTab } from "@/components/features/admin-offices-documents";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeDocumentsTab id={id} />;
}
