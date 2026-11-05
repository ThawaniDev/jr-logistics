"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Bell, LogOut, Menu, X, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT, useI18n } from "@/i18n/provider";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/core";
import { fetcher, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useUser, hasPerm } from "./auth-context";
import { NAV } from "./nav";

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  return (
    <select aria-label="Language" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className={cn("rounded-lg border border-line bg-bg2 text-sm text-ink focus:border-accent", compact ? "h-8 px-2" : "h-9 px-3")}>
      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_LABEL[l]}</option>)}
    </select>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/jr-logo-mark.png" alt="" width={size} height={size} className="rounded-lg" unoptimized priority />
      <span className="text-lg font-extrabold tracking-tight">JR <span className="text-gradient">Logistics</span></span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser();
  const t = useT();
  const { locale } = useI18n();
  const path = usePathname();
  const router = useRouter();
  // The drawer is open only for the path it was opened on, so navigating closes it without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === path;
  const setOpen = (v: boolean) => setOpenPath(v ? path : null);
  const groups = (NAV[user.role] ?? []).map((g) => ({ ...g, items: g.items.filter((i) => { const p = i.perm; return !p || (Array.isArray(p) ? p.some((x) => hasPerm(user, x)) : hasPerm(user, p)); }) })).filter((g) => g.items.length);
  const { data: n } = useSWR("/notifications?unread=1", fetcher, { refreshInterval: 30_000, revalidateOnFocus: true });
  const showWallet = ["business", "driver", "office"].includes(user.role);
  const { data: w } = useSWR(showWallet ? "/wallet" : null, fetcher, { refreshInterval: 60_000 });
  const base = user.role === "admin" || user.role === "staff" ? "/admin" : `/${user.role}`;
  const allItems = groups.flatMap((g) => g.items);
  const active = (href: string) => (href === base ? path === href : path === href || path.startsWith(href + "/")) && !allItems.some((o) => o.href.length > href.length && (path === o.href || path.startsWith(o.href + "/")));

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.key && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/70">{t(g.key)}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition", active(i.href) ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-card hover:text-ink")}>
                  <i.icon className="size-[18px] shrink-0" aria-hidden /><span className="truncate">{t(i.key)}</span>
                  {i.href.endsWith("/notifications") && n?.unread > 0 && <span className="ms-auto rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">{n.unread}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  async function logout() { await post("/auth/logout").catch(() => {}); router.replace("/login"); router.refresh(); }

  return (
    <div className="min-h-dvh bg-bg">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-bg2 lg:flex">
        <div className="flex h-16 items-center border-b border-line px-5"><Link href={base}><Logo /></Link></div>
        {nav}
        <div className="border-t border-line p-3">
          <div className="mb-2 flex items-center gap-3 rounded-xl px-2 py-1.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-accent-ink">{user.name.slice(0, 1)}</span>
            <div className="min-w-0 text-sm"><p className="truncate font-medium">{user.name}</p><p className="truncate text-xs text-muted">{t(`role.${user.role}`)}</p></div>
          </div>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-card hover:text-ink"><LogOut className="size-4 rtl:rotate-180" aria-hidden />{t("auth.logout")}</button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={cn("fixed inset-y-0 start-0 z-50 flex w-72 flex-col bg-bg2 transition-transform lg:hidden", open ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full")} aria-hidden={!open}>
        <div className="flex h-16 items-center justify-between border-b border-line px-5"><Logo /><button onClick={() => setOpen(false)} aria-label="Close menu" className="text-muted"><X className="size-5" /></button></div>
        {nav}
        <div className="border-t border-line p-3"><button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-card"><LogOut className="size-4 rtl:rotate-180" />{t("auth.logout")}</button></div>
      </aside>

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 text-muted hover:text-ink lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="lg:hidden"><Logo size={28} /></div>
          <div className="ms-auto flex items-center gap-2 sm:gap-3">
            {showWallet && w && <Link href={`${base}/wallet`} className="flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold"><Wallet className="size-4" aria-hidden /><span className="ltr-num tabular-nums">{fmtMoney(w.availableCents, locale)}</span></Link>}
            <LanguageSwitcher compact />
            <Link href={`${base}/notifications`} className="relative rounded-xl border border-line p-2 text-muted hover:text-ink" aria-label={t("nav.notifications")}>
              <Bell className="size-[18px]" />{n?.unread > 0 && <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">{n.unread > 9 ? "9+" : n.unread}</span>}
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
