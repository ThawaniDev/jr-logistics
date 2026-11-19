import type { ReactNode } from "react";
import { VerificationFrame } from "@/components/features/admin-verification-frame";

export default function VerificationLayout({ children }: { children: ReactNode }) { return <VerificationFrame>{children}</VerificationFrame>; }
