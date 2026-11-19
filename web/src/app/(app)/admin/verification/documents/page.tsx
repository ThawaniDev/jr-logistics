import { Suspense } from "react";
import { PageLoading } from "@/components/ui";
import { VerificationDocs } from "@/components/features/admin-verification-docs";

export default function AdminVerificationDocuments() { return <Suspense fallback={<PageLoading />}><VerificationDocs /></Suspense>; }
