import { EditAccount } from "@/components/features/admin-create-pages";

export default async function EditDriver({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditAccount kind="driver" id={id} />;
}
