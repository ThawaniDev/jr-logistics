import { EditAccount } from "@/components/features/admin-create-pages";

export default async function EditOffice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditAccount kind="office" id={id} />;
}
