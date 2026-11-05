import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Bike, Building2, CarFront, Car, ClipboardCheck, Lock, MapPinned, ShieldCheck, Store, Truck, UsersRound, Wallet, Zap } from "lucide-react";
import { getT } from "@/i18n/server";
import { getCurrentUser, homeFor } from "@/server/auth/current";
import { Logo, LanguageSwitcher } from "@/components/layout/shell";

export default async function Landing() {
  const { t } = await getT();
  const user = await getCurrentUser();
  const cta = user ? { href: homeFor(user.role), label: t("landing.dashboard") } : { href: "/login", label: t("auth.login") };
  const services = [{ k: "delivery_driver", I: Bike }, { k: "car_with_driver", I: CarFront }, { k: "car_without_driver", I: Car }];
  const steps = [{ I: ClipboardCheck, k: 1 }, { I: Zap, k: 2 }, { I: MapPinned, k: 3 }, { I: Wallet, k: 4 }];
  const trust = [{ I: Lock, k: "escrow" }, { I: ShieldCheck, k: "verified" }, { I: UsersRound, k: "offices" }, { I: Truck, k: "tracking" }];
  const join = [{ I: Store, k: "business", href: "/login?role=business" }, { I: Truck, k: "driver", href: "/login?role=driver" }, { I: Building2, k: "office", href: "/login?role=office" }];
  return (
    <div className="bg-hero min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/"><Logo /></Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 text-sm text-muted md:flex"><a href="#services" className="hover:text-ink">{t("landing.nav_services")}</a><a href="#how" className="hover:text-ink">{t("landing.nav_how")}</a><a href="#trust" className="hover:text-ink">{t("landing.nav_trust")}</a><a href="#join" className="hover:text-ink">{t("landing.nav_join")}</a></nav>
          <div className="flex items-center gap-3"><LanguageSwitcher compact /><Link href={cta.href} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:brightness-110">{cta.label}</Link></div>
        </div>
      </header>
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
          <div>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent"><span className="size-1.5 rounded-full bg-accent" />{t("landing.badge")}</span>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">{t("landing.h1_a")} <span className="text-gradient">{t("landing.h1_b")}</span></h1>
            <p className="mt-5 max-w-lg text-lg text-muted">{t("landing.sub")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login?role=business" className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-semibold text-accent-ink hover:brightness-110">{t("landing.cta_business")}<ArrowRight className="size-4 rtl:rotate-180" /></Link>
              <Link href="/login?role=driver" className="inline-flex h-12 items-center rounded-xl border border-line bg-card px-6 font-medium hover:border-accent/60">{t("landing.cta_driver")}</Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 text-center">{(["s1", "s2", "s3"] as const).map((k) => <div key={k} className="rounded-2xl border border-line bg-card/60 px-3 py-4"><dt className="text-2xl font-extrabold text-gradient">{t(`landing.${k}_n`)}</dt><dd className="mt-1 text-xs text-muted">{t(`landing.${k}_l`)}</dd></div>)}</dl>
          </div>
          <div className="relative mx-auto w-full max-w-md"><div className="absolute -inset-6 rounded-[2rem] bg-brand-gradient opacity-10 blur-3xl" /><Image src="/jr-logo-lockup.png" alt="JR Logistics" width={900} height={604} unoptimized priority className="relative rounded-3xl border border-line shadow-2xl" /></div>
        </section>

        <section id="services" className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-extrabold">{t("landing.services_title")}</h2><p className="mt-2 max-w-2xl text-muted">{t("landing.services_sub")}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">{services.map(({ k, I }) => <div key={k} className="rounded-card border border-line bg-card p-6 transition hover:border-accent/50"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><I className="size-6" aria-hidden /></div><h3 className="text-lg font-semibold">{t(`svc.${k}`)}</h3><p className="mt-2 text-sm text-muted">{t(`svc.${k}_desc`)}</p></div>)}</div></section>

        <section id="how" className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-extrabold">{t("landing.how_title")}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-4">{steps.map(({ I, k }) => <li key={k} className="relative rounded-card border border-line bg-card p-6"><span className="absolute end-4 top-3 text-5xl font-black text-line">{k}</span><I className="mb-4 size-7 text-cyan" aria-hidden /><h3 className="font-semibold">{t(`landing.step${k}_t`)}</h3><p className="mt-2 text-sm text-muted">{t(`landing.step${k}_d`)}</p></li>)}</ol></section>

        <section id="trust" className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-extrabold">{t("landing.trust_title")}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{trust.map(({ I, k }) => <div key={k} className="rounded-card border border-line bg-card p-6"><I className="mb-4 size-7 text-gold" aria-hidden /><h3 className="font-semibold">{t(`landing.trust_${k}_t`)}</h3><p className="mt-2 text-sm text-muted">{t(`landing.trust_${k}_d`)}</p></div>)}</div></section>

        <section id="join" className="mx-auto max-w-6xl px-5 py-16"><h2 className="text-3xl font-extrabold">{t("landing.join_title")}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">{join.map(({ I, k, href }) => <Link key={k} href={href} className="group rounded-card border border-line bg-card p-6 transition hover:border-accent/60"><I className="mb-4 size-8 text-accent" aria-hidden /><h3 className="text-lg font-semibold">{t(`reg.role_${k}`)}</h3><p className="mt-2 text-sm text-muted">{t(`reg.role_${k}_sub`)}</p><span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan">{t("landing.get_started")}<ArrowRight className="size-4 transition group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" /></span></Link>)}</div></section>
      </main>
      <footer className="border-t border-line"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-muted"><Logo size={28} /><p>{t("landing.footer")}</p><Link href="/staff/login" className="text-xs hover:text-ink">{t("auth.staff_link")}</Link></div></footer>
    </div>
  );
}
