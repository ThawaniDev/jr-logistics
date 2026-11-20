"use client";
import { Suspense, use } from "react";
import { PageLoading } from "@/components/ui";
import { BusinessInvoiceDetail } from "@/components/features/invoice-business";

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<PageLoading />}><BusinessInvoiceDetail id={id} /></Suspense>;
}
