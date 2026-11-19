import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Bike,
  Building2,
  CarFront,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  MapPinned,
  PackageSearch,
  Users,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  UserCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { getT } from "@/i18n/server";
import { getCurrentUser, homeFor } from "@/server/auth/current";
import { Logo, LanguageSwitcher } from "@/components/layout/shell";
import { CostCalculator } from "@/components/features/cost-calculator";

export default async function Landing() {
  const { t } = await getT();
  const user = await getCurrentUser();
  const cta = user
    ? { href: homeFor(user.role), label: t("landing.dashboard") }
    : { href: "/login", label: t("landing.get_started") };

  const services = [
    {
      k: "delivery_driver",
      I: Bike,
      unit: "shipment",
      tag: t("landing.available_now"),
      desc: t("svc.delivery_driver_desc"),
      features: [t("unit.shipment"), t("landing.fc1_t"), t("landing.fc2_t")],
      href: "/login?role=business",
      ctaLabel: t("landing.cta_business"),
    },
    {
      k: "car_with_driver",
      I: CarFront,
      unit: "vehicle_day",
      tag: t("landing.available_now"),
      desc: t("svc.car_with_driver_desc"),
      features: [t("unit.vehicle_day"), t("landing.stat3_lbl"), t("landing.fc2_t")],
      href: "/login?role=business",
      ctaLabel: t("landing.cta_business"),
    },
    {
      k: "car_without_driver",
      I: Car,
      unit: "vehicle_day",
      tag: t("landing.available_now"),
      desc: t("svc.car_without_driver_desc"),
      features: [t("unit.vehicle_day"), t("landing.step1_t"), t("landing.fc2_t")],
      href: "/login?role=business",
      ctaLabel: t("landing.cta_business"),
    },
  ];

  const comingSoonServices = [
    { name: t("ux.d_soon_dyna"), icon: Truck },
    { name: t("ux.d_soon_cold"), icon: Sparkles },
    { name: t("ux.d_soon_intercity"), icon: MapPinned },
    { name: t("ux.d_soon_express"), icon: Zap },
  ];

  const steps = [
    { I: ClipboardCheck, step: "01", t: t("landing.step1_t"), d: t("landing.step1_d") },
    { I: Zap, step: "02", t: t("landing.step2_t"), d: t("landing.step2_d") },
    { I: MapPinned, step: "03", t: t("landing.step3_t"), d: t("landing.step3_d") },
    { I: Wallet, step: "04", t: t("landing.step4_t"), d: t("landing.step4_d") },
  ];

  const trust = [
    { I: Wallet, title: t("landing.trust_escrow_t"), desc: t("landing.trust_escrow_d"), tone: "gold" },
    { I: ShieldCheck, title: t("landing.trust_verified_t"), desc: t("landing.trust_verified_d"), tone: "accent" },
    { I: Building2, title: t("landing.trust_offices_t"), desc: t("landing.trust_offices_d"), tone: "cyan" },
    { I: Clock, title: t("landing.trust_tracking_t"), desc: t("landing.trust_tracking_d"), tone: "accent" },
  ];

  const portals = [
    {
      k: "business",
      I: Store,
      title: t("landing.join_biz_t"),
      desc: t("landing.join_biz_d"),
      cta: t("landing.join_biz_btn"),
      href: "/login?role=business",
      tagTone: "border-accent/40 bg-accent/10 text-accent",
      btnClass: "bg-accent text-accent-ink hover:brightness-110 shadow-[0_0_20px_rgba(5,229,163,0.3)]",
    },
    {
      k: "driver",
      I: UserCheck,
      title: t("landing.join_drv_t"),
      desc: t("landing.join_drv_d"),
      cta: t("landing.join_drv_btn"),
      href: "/login?role=driver",
      tagTone: "border-cyan/40 bg-cyan/10 text-cyan",
      btnClass: "border border-line bg-card text-ink hover:border-cyan hover:text-cyan",
    },
    {
      k: "office",
      I: Building2,
      title: t("landing.join_office_t"),
      desc: t("landing.join_office_d"),
      cta: t("landing.join_office_btn"),
      href: "/login?role=office",
      tagTone: "border-gold/40 bg-gold/10 text-gold",
      btnClass: "border border-gold/40 bg-gold/15 text-gold hover:bg-gold/25",
    },
  ];

  return (
    <div className="min-h-dvh bg-bg text-ink hero-grid-pattern selection:bg-accent/30">
      {/* ── Top Navigation Bar ── */}
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:h-20 sm:px-8">
          <Link href="/" aria-label="JR Logistics">
            <Logo size={36} />
          </Link>

          <nav aria-label={t("a11y.main_nav")} className="hidden items-center gap-8 text-sm font-medium text-muted lg:flex">
            <a href="#services" className="transition hover:text-accent">
              {t("landing.nav_services")}
            </a>
            <a href="#how" className="transition hover:text-accent">
              {t("landing.nav_how")}
            </a>
            <a href="#estimate" className="transition hover:text-accent">
              {t("landing.nav_estimate")}
            </a>
            <a href="#trust" className="transition hover:text-accent">
              {t("landing.nav_trust")}
            </a>
            <a href="#join" className="transition hover:text-accent">
              {t("landing.nav_join")}
            </a>
            <Link href="/track" className="transition hover:text-accent">
              {t("bs.land_track_link")}
            </Link>
            <Link
              href="/scenarios"
              className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 text-xs font-semibold text-accent transition hover:bg-accent hover:text-accent-ink"
            >
              <span>{t("nav.scenarios")}</span>
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            {!user && (
              <Link
                href="/login"
                className="hidden px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:text-ink sm:inline-block"
              >
                {t("auth.login")}
              </Link>
            )}
            <Link
              href={cta.href}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-ink hover:brightness-110 shadow-[0_0_20px_rgba(5,229,163,0.35)] transition-all"
            >
              {cta.label}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── Hero Section (Matches Reference Image) ── */}
        <section className="relative overflow-hidden pt-12 pb-20 sm:pt-16 sm:pb-28">
          {/* Subtle Ambient Radial Lighting */}
          <div className="pointer-events-none absolute top-10 start-1/4 -z-10 size-[480px] -translate-x-1/2 rounded-full bg-cyan/10 blur-[140px]" />
          <div className="pointer-events-none absolute top-28 end-10 -z-10 size-[420px] rounded-full bg-accent/10 blur-[130px]" />

          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
            {/* Right Column in RTL: Headlines, CTAs & Stats */}
            <div>
              {/* Saudi Platform Pill Badge & Scenarios Bank Link */}
              <div className="mb-6 flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-semibold text-accent backdrop-blur-sm shadow-sm">
                  <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_#05e5a3] animate-pulse" />
                  <span>{t("landing.badge")}</span>
                </div>
                <Link
                  href="/scenarios"
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/10 px-3.5 py-1.5 text-xs font-semibold text-cyan hover:bg-cyan/20 transition backdrop-blur-sm shadow-sm"
                >
                  <Sparkles className="size-3.5 text-cyan" />
                  <span>{t("ux.d_land_scenarios")}</span>
                </Link>
              </div>

              {/* Main Headline */}
              <h1 className="text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                {t("landing.h1_a")}{" "}
                <span className="block mt-1 sm:mt-2">
                  {t("landing.h1_b")}{" "}
                  <span className="text-accent drop-shadow-[0_0_25px_rgba(5,229,163,0.4)]">
                    {t("landing.h1_c")}
                  </span>
                </span>
              </h1>

              {/* Subtitle */}
              <p className="mt-6 max-w-xl text-base sm:text-lg text-muted/90 leading-relaxed">
                {t("landing.sub")}
              </p>

              {/* Action Buttons (3 Roles) */}
              <div className="mt-8 space-y-3">
                <div className="flex flex-wrap gap-3 sm:gap-4">
                  {/* Primary - Business */}
                  <Link
                    href="/login?role=business"
                    className="group flex flex-1 min-w-[240px] items-center justify-between gap-3 rounded-2xl bg-accent px-6 py-3.5 text-sm sm:text-base font-bold text-accent-ink hover:brightness-110 shadow-[0_0_25px_rgba(5,229,163,0.3)] transition-all"
                  >
                    <div className="flex items-center gap-2.5">
                      <Store className="size-5" aria-hidden />
                      <span>{t("landing.cta_business")}</span>
                    </div>
                    <ArrowRight className="size-4 rtl:rotate-180 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden />
                  </Link>

                  {/* Secondary - Driver */}
                  <Link
                    href="/login?role=driver"
                    className="flex flex-1 min-w-[200px] items-center justify-center gap-2.5 rounded-2xl border border-line bg-card/75 backdrop-blur-sm px-6 py-3.5 text-sm sm:text-base font-bold text-ink hover:border-accent/60 hover:text-accent transition-all"
                  >
                    <UserCheck className="size-5 text-muted" aria-hidden />
                    <span>{t("landing.cta_driver")}</span>
                  </Link>
                </div>

                {/* Third Option - Courier Office */}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/login?role=office"
                    className="inline-flex items-center gap-2.5 rounded-2xl border border-cyan/35 bg-cyan/10 px-5 py-2.5 text-xs sm:text-sm font-semibold text-cyan hover:border-cyan/60 hover:bg-cyan/20 transition-all"
                  >
                    <Truck className="size-4.5" aria-hidden />
                    <span>{t("landing.cta_office")}</span>
                  </Link>
                  <Link
                    href="/track"
                    className="inline-flex items-center gap-2.5 rounded-2xl border border-line bg-card/70 px-5 py-2.5 text-xs sm:text-sm font-semibold text-ink hover:border-accent/60 hover:text-accent transition-all"
                  >
                    <PackageSearch className="size-4.5" aria-hidden />
                    <span>{t("bs.land_track_link")}</span>
                  </Link>
                </div>
              </div>

              {/* Three Stat Cards */}
              <div className="mt-10 grid grid-cols-3 gap-3 sm:gap-4 max-w-md sm:max-w-lg">
                <div className="rounded-2xl border border-line/75 bg-card/65 backdrop-blur-md px-3 py-4 text-center transition hover:border-accent/40 shadow-sm">
                  <p className="text-xl sm:text-2xl font-black text-accent ltr-num">
                    {t("landing.stat1_val")}
                  </p>
                  <p className="mt-1 text-xs text-muted font-medium">
                    {t("landing.stat1_lbl")}
                  </p>
                </div>
                <div className="rounded-2xl border border-line/75 bg-card/65 backdrop-blur-md px-3 py-4 text-center transition hover:border-accent/40 shadow-sm">
                  <p className="text-lg sm:text-xl font-black text-accent">
                    {t("landing.stat2_val")}
                  </p>
                  <p className="mt-1 text-xs text-muted font-medium">
                    {t("landing.stat2_lbl")}
                  </p>
                </div>
                <div className="rounded-2xl border border-line/75 bg-card/65 backdrop-blur-md px-3 py-4 text-center transition hover:border-accent/40 shadow-sm">
                  <p className="text-xl sm:text-2xl font-black text-accent ltr-num">
                    {t("landing.stat3_val")}
                  </p>
                  <p className="mt-1 text-xs text-muted font-medium">
                    {t("landing.stat3_lbl")}
                  </p>
                </div>
              </div>
            </div>

            {/* Left Column in RTL: Hero Image with 2 Floating Glass Badges */}
            <div className="relative mx-auto w-full max-w-lg lg:max-w-xl">
              {/* Back Glow Effect */}
              <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-gradient-to-tr from-cyan/25 to-accent/25 opacity-40 blur-3xl -z-10" />

              {/* Floating Badge 1 - Top Start (Amber Escrow Protection) */}
              <div className="absolute -top-5 start-4 sm:-start-4 z-20 flex items-center gap-3 rounded-2xl border border-amber-500/35 bg-[#0b132b]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
                  <ShieldCheck className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-ink">{t("landing.fc2_t")}</p>
                  <p className="text-[11px] text-muted">{t("landing.fc2_d")}</p>
                </div>
              </div>

              {/* Photo Frame Container */}
              <div className="relative overflow-hidden rounded-3xl border border-line/80 shadow-2xl bg-card">
                <Image
                  src="/hero-warehouse.jpg"
                  alt={t("landing.fc2_t")}
                  width={900}
                  height={600}
                  priority
                  unoptimized
                  className="h-[360px] sm:h-[430px] w-full object-cover object-center"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg/90 via-bg/20 to-transparent" />
              </div>

              {/* Floating Badge 2 - Bottom End (Cyan Instant Match) */}
              <div className="absolute -bottom-5 end-4 sm:-end-4 z-20 flex items-center gap-3 rounded-2xl border border-accent/40 bg-[#0b132b]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent">
                  <Zap className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-ink">{t("landing.fc1_t")}</p>
                  <p className="text-[11px] text-muted">{t("landing.fc1_d")}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Services Section ── */}
        <section id="services" className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-4 py-1 text-xs font-semibold text-cyan">
              {t("landing.services_eyebrow")}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">
              {t("landing.services_title")}
            </h2>
            <p className="mt-3 max-w-2xl mx-auto text-sm sm:text-base text-muted">
              {t("landing.services_sub")}
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {services.map(({ k, I, desc, tag, features, href, ctaLabel }) => (
              <div
                key={k}
                className="group relative flex flex-col justify-between rounded-3xl border border-line bg-card/65 p-7 backdrop-blur-md transition-all hover:border-accent/60 hover:shadow-2xl hover:shadow-accent/5"
              >
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/25 text-accent transition-transform group-hover:scale-105">
                      <I className="size-7" aria-hidden />
                    </div>
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent">
                      {tag}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-ink">{t(`svc.${k}`)}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{desc}</p>

                  <div className="mt-6 space-y-2.5 border-t border-line/60 pt-5">
                    {features.map((feat, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-muted">
                        <CheckCircle2 className="size-4 text-accent shrink-0" aria-hidden />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 pt-4">
                  <Link
                    href={href}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-bg2/70 px-4 py-2.5 text-sm font-semibold text-ink group-hover:border-accent group-hover:bg-accent group-hover:text-accent-ink transition-all"
                  >
                    <span>{ctaLabel}</span>
                    <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Upcoming Services Expandable Row */}
          <div className="mt-14 rounded-3xl border border-line/60 bg-bg2/40 p-6 sm:p-8 text-center backdrop-blur-sm">
            <p className="text-xs font-semibold text-cyan uppercase tracking-wider">
              {t("landing.coming_title")}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("landing.coming_sub")}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {comingSoonServices.map(({ name, icon: SIcon }) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-full border border-line/80 bg-card/60 px-4 py-2 text-xs font-medium text-muted/80 opacity-80"
                >
                  <SIcon className="size-3.5 text-muted/60" aria-hidden />
                  <span>{name}</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                    {t("landing.coming_soon")}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Businesses AND consumers (B2B + B2C) ── */}
        <section id="audiences" className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-xs font-semibold text-accent">
              {t("bs.land_eyebrow")}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">{t("bs.land_title")}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm sm:text-base text-muted">{t("bs.land_sub")}</p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-line/80 bg-card/70 p-6 backdrop-blur-md">
              <Store className="size-7 text-accent" aria-hidden />
              <h3 className="mt-3 text-lg font-bold">{t("bs.land_b2b_t")}</h3>
              <p className="mt-1 text-sm text-muted">{t("bs.land_b2b_d")}</p>
            </div>
            <div className="rounded-3xl border border-line/80 bg-card/70 p-6 backdrop-blur-md">
              <Users className="size-7 text-cyan" aria-hidden />
              <h3 className="mt-3 text-lg font-bold">{t("bs.land_b2c_t")}</h3>
              <p className="mt-1 text-sm text-muted">{t("bs.land_b2c_d")}</p>
            </div>
            <div className="rounded-3xl border border-accent/40 bg-accent/5 p-6 backdrop-blur-md">
              <PackageSearch className="size-7 text-accent" aria-hidden />
              <h3 className="mt-3 text-lg font-bold">{t("bs.land_track_t")}</h3>
              <p className="mt-1 text-sm text-muted">{t("bs.land_track_d")}</p>
              <Link href="/track" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-ink hover:brightness-110">
                <span>{t("bs.land_track_link")}</span>
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* ── How It Works Section ── */}
        <section id="how" className="border-y border-line/60 bg-bg2/40 py-20 px-5 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-xs font-semibold text-accent">
                {t("landing.how_eyebrow")}
              </span>
              <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">
                {t("landing.how_title")}
              </h2>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map(({ I, step, t: title, d: desc }) => (
                <div
                  key={step}
                  className="relative rounded-3xl border border-line/80 bg-card/70 p-6 backdrop-blur-md transition-all hover:border-cyan/50"
                >
                  <span className="absolute end-5 top-4 font-black text-4xl text-line/80 ltr-num select-none">
                    {step}
                  </span>
                  <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-cyan/30 bg-cyan/10 text-cyan">
                    <I className="size-6" aria-hidden />
                  </div>
                  <h3 className="text-lg font-bold text-ink">{title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Interactive Cost Calculator ── */}
        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <CostCalculator />
        </section>

        {/* ── Trust & Security Section ── */}
        <section id="trust" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 border-t border-line/60">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1 text-xs font-semibold text-amber-400">
              {t("landing.trust_eyebrow")}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">
              {t("landing.trust_title")}
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {trust.map(({ I, title, desc, tone }) => {
              const colorClasses =
                tone === "gold"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : tone === "cyan"
                  ? "border-cyan/30 bg-cyan/10 text-cyan"
                  : "border-accent/30 bg-accent/10 text-accent";

              return (
                <div
                  key={title}
                  className="rounded-3xl border border-line bg-card/65 p-6 backdrop-blur-md transition hover:border-line/90"
                >
                  <div className={`mb-5 flex size-12 items-center justify-center rounded-2xl border ${colorClasses}`}>
                    <I className="size-6" aria-hidden />
                  </div>
                  <h3 className="font-bold text-base text-ink">{title}</h3>
                  <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted">{desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Join The Ecosystem (3 Portals) ── */}
        <section id="join" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 border-t border-line/60">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-xs font-semibold text-accent">
              {t("landing.join_eyebrow")}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl text-ink">
              {t("landing.join_title")}
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {portals.map(({ k, I, title, desc, cta: btnText, href, tagTone, btnClass }) => (
              <div
                key={k}
                className="group flex flex-col justify-between rounded-3xl border border-line bg-card/60 p-8 backdrop-blur-md transition-all hover:border-accent/50 hover:shadow-2xl hover:shadow-accent/5"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-bg2 border border-line text-ink">
                      <I className="size-7" aria-hidden />
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tagTone}`}>
                      {t(`role.${k}`)}
                    </span>
                  </div>

                  <h3 className="text-xl font-extrabold text-ink">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{desc}</p>
                </div>

                <div className="mt-8 pt-4">
                  <Link
                    href={href}
                    className={`inline-flex w-full h-12 items-center justify-center gap-2 rounded-xl px-5 font-bold text-sm transition-all ${btnClass}`}
                  >
                    <span>{btnText}</span>
                    <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* ── Full Modern Footer ── */}
      <footer className="border-t border-line/80 bg-bg2/80 py-12 px-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 md:grid-cols-12 items-center justify-between pb-8 border-b border-line/60">
            <div className="md:col-span-5">
              <Logo size={32} />
              <p className="mt-3 text-xs sm:text-sm text-muted max-w-md leading-relaxed">
                {t("landing.footer")}
              </p>
              <p className="mt-2 text-xs text-muted/70">
                {t("landing.footer_coverage")}
              </p>
            </div>

            <div className="md:col-span-4 flex flex-wrap gap-6 text-xs sm:text-sm font-medium text-muted">
              <a href="#services" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
                {t("landing.nav_services")}
              </a>
              <a href="#how" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
                {t("landing.nav_how")}
              </a>
              <a href="#estimate" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
                {t("landing.nav_estimate")}
              </a>
              <a href="#trust" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
                {t("landing.nav_trust")}
              </a>
              <a href="#join" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
                {t("landing.nav_join")}
              </a>
            </div>

            <div className="md:col-span-3 flex flex-col sm:items-end gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/5 px-3 py-1 text-accent font-medium">
                <Sparkles className="size-3" aria-hidden />
                {t("landing.footer_vision")}
              </span>
              <div className="flex gap-4">
                <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-ink">{t("landing.terms")}</Link>
                <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-ink">{t("landing.privacy")}</Link>
              </div>
              <Link href="/staff/login" className="inline-flex min-h-11 items-center transition-colors hover:text-ink">
                {t("auth.staff_link")}
              </Link>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted/70">
            <p>© {new Date().getFullYear()} JR Logistics. {t("landing.rights")}</p>
            <p className="text-[11px]">{t("landing.footer_disclaimer")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
