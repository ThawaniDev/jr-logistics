import { RequestShell } from "@/components/features/business-views-request-shell";

/** One order = a header + section tabs that are real routes (overview · parcels · money · activity); the data is loaded once, here. */
export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return <RequestShell>{children}</RequestShell>;
}
