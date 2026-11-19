import { Spinner } from "@/components/ui";

/** Route-level fallback while a server component streams in. */
export default function Loading() {
  return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Spinner className="size-8" /></div>;
}
