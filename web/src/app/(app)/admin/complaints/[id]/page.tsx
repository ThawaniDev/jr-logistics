"use client";
import { Suspense, use } from "react";
import { PageLoading } from "@/components/ui";
import { ComplaintDetail } from "@/components/features/admin-system-complaint";

export default function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<PageLoading />}><ComplaintDetail id={id} /></Suspense>;
}
