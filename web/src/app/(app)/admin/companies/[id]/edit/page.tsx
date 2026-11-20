import { EditAccount } from "@/components/features/admin-create-pages";

export default async function EditCompany({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditAccount kind="business" id={id} />;
}
