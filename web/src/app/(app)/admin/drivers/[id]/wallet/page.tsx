import { DriverMoneyTab } from "@/components/features/admin-drivers-money";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverMoneyTab id={id} />;
}
