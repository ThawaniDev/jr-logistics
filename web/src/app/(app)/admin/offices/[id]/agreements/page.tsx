import { OfficeAgreementsTab } from "@/components/features/admin-offices-agreements";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfficeAgreementsTab id={id} />;
}
