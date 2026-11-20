"use client";
import { Suspense, use } from "react";
import { PageLoading } from "@/components/ui";
import { AdminInvoiceDetail } from "@/components/features/invoice-admin";

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<PageLoading />}><AdminInvoiceDetail id={id} /></Suspense>;
}
