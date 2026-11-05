import Link from "next/link";
import { Logo, LanguageSwitcher } from "@/components/layout/shell";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-hero min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5"><Link href="/"><Logo /></Link><LanguageSwitcher /></header>
      <main id="main" className="mx-auto flex max-w-6xl justify-center px-5 pb-16 pt-6">{children}</main>
    </div>
  );
}
