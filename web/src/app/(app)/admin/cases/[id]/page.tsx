"use client";
import { Suspense, use } from "react";
import { PageLoading } from "@/components/ui";
import { CaseDetail } from "@/components/features/admin-system-case";

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<PageLoading />}><CaseDetail id={id} /></Suspense>;
}
