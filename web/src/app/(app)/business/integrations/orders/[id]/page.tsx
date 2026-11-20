import { PartnerOrderView } from "@/components/features/partner-orders-detail";

export default async function IncomingOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartnerOrderView id={id} apiBase="/integrations" />;
}
