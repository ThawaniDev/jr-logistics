import { PartnerOrderView } from "@/components/features/partner-orders-detail";

export default async function AdminIncomingOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartnerOrderView id={id} apiBase="/admin/integrations" />;
}
