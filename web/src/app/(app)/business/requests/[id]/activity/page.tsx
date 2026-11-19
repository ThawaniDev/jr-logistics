"use client";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { RequestActivity } from "@/components/features/business-views-request-activity";

export default function Page() { return <Suspense fallback={<PageLoading />}><RequestActivity /></Suspense>; }
