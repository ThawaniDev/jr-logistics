"use client";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { OrdersList } from "@/components/features/business-views-orders";

export default function RequestsPage() { return <Suspense fallback={<PageLoading />}><OrdersList /></Suspense>; }
