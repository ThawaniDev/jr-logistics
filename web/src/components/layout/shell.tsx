"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import useSWR from "swr";
import { ArrowLeft, Bell, ChevronDown, CornerDownLeft, Globe, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Wallet, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT, useI18n } from "@/i18n/provider";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/core";
import { fetcher, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { Modal } from "@/components/ui";
import { useUser, hasPerm } from "./auth-context";
import { activeItem, flatNav, visibleNav, type BadgeId, type NavGroup } from "./nav";
import { relabelWalletNav } from "@/components/features/driver-nav-labels";

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="relative inline-flex items-center">
      <Globe className="pointer-events-none absolute start-2.5 size-3.5 text-muted/70" aria-hidden />
      <select
        aria-label={t("a11y.language")}
        data-testid="lang-switch"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className={cn(
          "cursor-pointer rounded-xl border border-line/80 bg-card/70 backdrop-blur-sm text-ink transition hover:border-accent/60 focus:border-accent focus:outline-none",
          compact ? "h-8.5 ps-8 pe-3 text-xs" : "h-10 ps-9 pe-4 text-sm"
        )}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-card text-ink">
            {LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Logo({ size = 36, compact }: { size?: number; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/jr-logo-mark.png" alt="" width={size} height={size} className="rounded-lg" unoptimized priority />
      <span className={cn("text-lg font-extrabold tracking-tight", compact && "max-[430px]:hidden")}>JR <span className="text-gradient">Logistics</span></span>
    </span>
  );
}

// ───────── Sidebar preferences (collapsed rail, closed groups) — saved per role in localStorage ─────────
const PREFS_KEY = "jr.nav.v2";
const PREFS_EVENT = "jr:nav-prefs";
interface NavPrefs { collapsed: boolean; closed: string[] }
const DEFAULT_PREFS: NavPrefs = { collapsed: false, closed: [] };
function parsePrefs(raw: string): NavPrefs {
  try { const v = JSON.parse(raw); return { collapsed: v?.collapsed === true, closed: Array.isArray(v?.closed) ? v.closed.filter((x: unknown) => typeof x === "string") : [] }; } catch { return DEFAULT_PREFS; }
}
function useNavPrefs(role: string) {
  const key = `${PREFS_KEY}.${role}`;
  const subscribe = useCallback((cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener(PREFS_EVENT, cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener(PREFS_EVENT, cb); }; }, []);
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }, () => "");
  const prefs = useMemo(() => parsePrefs(raw), [raw]);
  const save = useCallback((next: NavPrefs) => { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode: the choice just lasts until reload */ } window.dispatchEvent(new Event(PREFS_EVENT)); }, [key]);
  return { prefs, save };
}

/** Live counters shown next to sidebar entries. Each is fetched only when the signed-in user can open the thing it counts. */
function useBadges(user: ReturnType<typeof useUser>): Partial<Record<BadgeId, number>> {
  const backoffice = user.role === "admin" || user.role === "staff";
  const canStats = backoffice && ["requests.view", "finance.view", "users.view", "reports.view"].some((p) => hasPerm(user, p));
  const { data: n } = useSWR("/notifications?unread=1", fetcher, { refreshInterval: 30_000, revalidateOnFocus: true });
  const { data: stats } = useSWR(canStats ? "/admin/stats" : null, fetcher, { refreshInterval: 60_000, shouldRetryOnError: false });
  // Businesses see how many things wait for them on the Orders entry (a driver arrived and the warehouse has to confirm it).
  const { data: ov } = useSWR(user.role === "business" ? "/business/overview" : null, fetcher, { refreshInterval: 60_000 });
  // Orders sent by connected warehouse systems that are still waiting to be put on a JR delivery order (Integrations → Incoming orders).
  const { data: io } = useSWR(user.role === "business" ? "/integrations/orders?state=open&pageSize=1" : null, fetcher, { refreshInterval: 60_000, shouldRetryOnError: false });
  const pv = stats?.pendingVerification;
  return {
    notifications: n?.unread ?? 0,
    requests_action: ov?.pendingAttendance ?? 0,
    incoming_orders: io?.counts?.open ?? 0,
    verification: pv ? (pv.business ?? 0) + (pv.office ?? 0) + (pv.drivers ?? 0) : 0,
    cases: stats?.openTickets ?? 0,
    complaints: stats?.openComplaints ?? 0,
    withdrawals: stats?.pendingWithdrawals ?? 0,
    settlements: stats?.pendingSettlements ?? 0,
  };
}

function SidebarNav({ groups, path, badges, rail, closed, onToggleGroup, onNavigate }: { groups: NavGroup[]; path: string; badges: Partial<Record<BadgeId, number>>; rail?: boolean; closed: string[]; onToggleGroup: (id: string) => void; onNavigate?: () => void }) {
  const t = useT();
  const current = activeItem(groups, path);
  return (
    <nav aria-label={t("a11y.main_nav")} className={cn("flex-1 overflow-y-auto py-3", rail ? "space-y-2 px-2" : "space-y-1 px-3")}>
      {groups.map((g, gi) => {
        const hasActive = g.items.some((i) => i === current);
        const open = !g.key || rail || hasActive || !closed.includes(g.id);
        const panel = `nav-group-${g.id}`;
        return (
          <div key={g.id} className={cn(rail && gi > 0 && "border-t border-line/70 pt-2")}>
            {g.key && !rail && (
              <button type="button" onClick={() => !hasActive && onToggleGroup(g.id)} aria-expanded={open} aria-controls={panel} disabled={hasActive} aria-label={t("nav.toggle_group", { group: t(g.key) })} className="group mt-2 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/80 transition hover:text-ink disabled:cursor-default disabled:hover:text-muted/80">
                <span>{t(g.key)}</span>
                <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90 rtl:rotate-90", hasActive && "opacity-30")} aria-hidden />
              </button>
            )}
            {open && (
              <ul id={panel} className="space-y-0.5">
                {g.items.map((i) => {
                  const on = i === current; const n = i.badge ? badges[i.badge] ?? 0 : 0;
                  const attention = i.badge && i.badge !== "notifications";
                  return (
                    <li key={i.href}>
                      <Link href={i.href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={rail ? t(i.key) : undefined}
                        className={cn("relative flex items-center rounded-xl text-sm transition", rail ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5", on ? "bg-accent/10 font-semibold text-accent before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-accent" : "text-muted hover:bg-card hover:text-ink")}>
                        <i.icon className="size-[18px] shrink-0" aria-hidden />
                        <span className={cn("truncate", rail && "sr-only")}>{t(i.key)}</span>
                        {n > 0 && (rail
                          ? <span aria-hidden className={cn("absolute end-1.5 top-1.5 size-2 rounded-full", attention ? "bg-gold" : "bg-accent")} />
                          : <span className={cn("ms-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums", attention ? "bg-gold/15 text-gold" : "bg-accent text-accent-ink")}>{n > 99 ? "99+" : n}</span>)}
                        {n > 0 && rail && <span className="sr-only">{n}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** ⌘K / Ctrl+K: type a few letters, Enter opens the page. Lists only what the signed-in user may open. */
function JumpDialog({ open, onClose, groups, onGo }: { open: boolean; onClose: () => void; groups: NavGroup[]; onGo: (href: string) => void }) {
  const t = useT();
  const [q, setQ] = useState(""); const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // the native dialog focuses its first control (the close button) when it opens: move focus to the search box right after
  useEffect(() => { if (!open) return; const id = requestAnimationFrame(() => input.current?.focus()); const t2 = setTimeout(() => input.current?.focus(), 80); return () => { cancelAnimationFrame(id); clearTimeout(t2); }; }, [open]);
  const all = useMemo(() => flatNav(groups), [groups]);
  const hits = useMemo(() => { const n = q.trim().toLowerCase(); return n ? all.filter(({ item, group }) => `${t(item.key)} ${group.key ? t(group.key) : ""}`.toLowerCase().includes(n)) : all; }, [all, q, t]);
  const idx = Math.min(sel, Math.max(0, hits.length - 1));
  function go(href: string) { setQ(""); setSel(0); onClose(); onGo(href); }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((idx + 1) % Math.max(1, hits.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((idx - 1 + hits.length) % Math.max(1, hits.length)); }
    else if (e.key === "Enter" && hits[idx]) { e.preventDefault(); go(hits[idx].item.href); }
  }
  return (
    <Modal open={open} onClose={() => { setQ(""); setSel(0); onClose(); }} title={t("nav.jump_title")}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="jump-list" aria-activedescendant={hits[idx] ? `jump-${idx}` : undefined} aria-label={t("nav.search_pages")} data-testid="jump-input" placeholder={t("nav.search_pages")} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} className="h-11 w-full rounded-xl border border-line bg-bg2 ps-9 pe-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
      </div>
      <ul id="jump-list" role="listbox" aria-label={t("nav.jump_title")} className="-mx-2 max-h-72 overflow-y-auto">
        {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t("nav.jump_empty")}</li>}
        {hits.map(({ item, group }, i) => (
          <li key={item.href} id={`jump-${i}`} role="option" aria-selected={i === idx}>
            <button type="button" tabIndex={-1} onClick={() => go(item.href)} onMouseMove={() => setSel(i)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm", i === idx ? "bg-accent/10 text-accent" : "text-ink hover:bg-bg2")}>
              <item.icon className="size-[18px] shrink-0" aria-hidden /><span className="truncate font-medium">{t(item.key)}</span>
              {group.key && <span className="ms-auto truncate text-xs text-muted">{t(group.key)}</span>}
              {i === idx && <CornerDownLeft className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function UserCard({ rail, onLogout, mobile }: { rail?: boolean; onLogout: () => void; mobile?: boolean }) {
  const user = useUser(); const t = useT();
  return (
    <div className="border-t border-line p-3">
      <div className={cn("mb-2 flex items-center gap-3 rounded-xl px-2 py-1.5", rail && "justify-center px-0")} title={rail ? user.name : undefined}>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-accent-ink">{user.name.slice(0, 1)}</span>
        {!rail && <div className="min-w-0 text-sm"><p className="truncate font-medium">{user.name}</p><p className="truncate text-xs text-muted">{t(`role.${user.role}`)}</p></div>}
      </div>
      <button onClick={onLogout} title={rail ? t("auth.logout") : undefined} className={cn("flex w-full items-center gap-2 rounded-xl text-sm text-muted hover:bg-card hover:text-ink", rail ? "justify-center py-2.5" : mobile ? "px-3 py-2.5" : "px-3 py-2")}><LogOut className="size-4 rtl:rotate-180" aria-hidden /><span className={cn(rail && "sr-only")}>{t("auth.logout")}</span></button>
    </div>
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
  const [jump, setJump] = useState(false);
  const { prefs, save } = useNavPrefs(user.role);
  const showWallet = ["business", "driver", "office"].includes(user.role);
  const { data: w } = useSWR(showWallet ? "/wallet" : null, fetcher, { refreshInterval: 60_000 });
  const managed = w?.managedByOffice === true; // J4: an office driver has no wallet balance to show (his sidebar entry is "Wallet & cash")
  const groups = useMemo(() => relabelWalletNav(visibleNav(user.role, (p) => hasPerm(user, p)), managed), [user, managed]);
  const badges = useBadges(user);
  const base = user.role === "admin" || user.role === "staff" ? "/admin" : `/${user.role}`;

  const current = activeItem(groups, path);
  const currentGroup = current ? groups.find((g) => g.items.includes(current)) : undefined;
  const title = current ? t(current.key) : "";
  const onSubPage = !!current && path !== current.href;
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const rail = prefs.collapsed;
  const toggleGroup = (id: string) => save({ ...prefs, closed: prefs.closed.includes(id) ? prefs.closed.filter((x) => x !== id) : [...prefs.closed, id] });
  // Page title in the tab (route changes are otherwise silent for screen readers and the history list).
  useEffect(() => { if (title) document.title = `${title} · JR Logistics`; }, [title, path]);
  // ⌘K / Ctrl+K opens the page switcher from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setJump(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Mobile drawer: Esc closes, the page behind does not scroll, focus moves in and returns to the menu button.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenPath(null); menuBtn.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    closeBtn.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  async function logout() { await post("/auth/logout").catch(() => {}); router.replace(user.role === "admin" || user.role === "staff" ? "/staff/login" : "/login"); router.refresh(); }

  const jumpBtn = (compact?: boolean) => (
    <button type="button" onClick={() => setJump(true)} data-testid="jump-open" aria-label={t("nav.search_pages")} title={compact ? t("nav.search_pages") : undefined} className={cn("flex items-center gap-2 rounded-xl border border-line bg-bg/60 text-sm text-muted transition hover:border-accent/50 hover:text-ink", compact ? "mx-auto size-10 justify-center" : "mx-3 mt-3 h-10 w-[calc(100%-1.5rem)] px-3")}>
      <Search className="size-4 shrink-0" aria-hidden />
      {!compact && <><span className="truncate">{t("nav.search_pages")}</span><kbd dir="ltr" className="ms-auto hidden rounded-md border border-line px-1.5 text-[11px] text-muted/80 lg:block">⌘K</kbd></>}
    </button>
  );

  return (
    <div className="min-h-dvh bg-bg">
      <aside className={cn("fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-line bg-bg2 transition-[width] duration-200 lg:flex", rail ? "w-[4.5rem]" : "w-64")}>
        <div className={cn("flex h-16 items-center border-b border-line", rail ? "justify-center" : "justify-between ps-5 pe-3")}>
          {rail ? <Link href={base} aria-label="JR Logistics"><Image src="/jr-logo-mark.png" alt="" width={32} height={32} className="rounded-lg" unoptimized /></Link> : <Link href={base}><Logo /></Link>}
          {!rail && <button type="button" onClick={() => save({ ...prefs, collapsed: true })} aria-label={t("nav.collapse_menu")} title={t("nav.collapse_menu")} data-testid="nav-collapse" className="jr-tap flex size-8 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><PanelLeftClose className="size-[18px] rtl:rotate-180" aria-hidden /></button>}
        </div>
        {jumpBtn(rail)}
        <SidebarNav groups={groups} path={path} badges={badges} rail={rail} closed={prefs.closed} onToggleGroup={toggleGroup} />
        {rail && <button type="button" onClick={() => save({ ...prefs, collapsed: false })} aria-label={t("nav.expand_menu")} title={t("nav.expand_menu")} data-testid="nav-expand" className="jr-tap mx-auto mb-2 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><PanelLeftOpen className="size-[18px] rtl:rotate-180" aria-hidden /></button>}
        <UserCard rail={rail} onLogout={logout} />
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={cn("fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-bg2 transition-transform lg:hidden", open ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full")} aria-hidden={!open} inert={!open}>
        <div className="flex h-16 items-center justify-between border-b border-line px-5"><Logo /><button ref={closeBtn} type="button" onClick={() => setOpen(false)} aria-label={t("a11y.close_menu")} className="jr-tap flex items-center justify-center rounded-lg p-1 text-muted hover:text-ink"><X className="size-5" /></button></div>
        {jumpBtn()}
        <SidebarNav groups={groups} path={path} badges={badges} closed={prefs.closed} onToggleGroup={toggleGroup} onNavigate={() => setOpen(false)} />
        <UserCard mobile onLogout={logout} />
      </aside>

      <div className={cn("transition-[padding] duration-200", rail ? "lg:ps-[4.5rem]" : "lg:ps-64")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button ref={menuBtn} type="button" className="jr-tap flex items-center justify-center rounded-lg p-2 text-muted hover:text-ink lg:hidden" onClick={() => setOpen(true)} aria-label={t("a11y.open_menu")} aria-expanded={open}><Menu className="size-5" /></button>
          <div className={cn("lg:hidden", onSubPage && "max-sm:hidden")}><Logo size={28} compact /></div>
          {current && onSubPage && <Link href={current.href} className="flex min-w-0 items-center gap-1.5 rounded-lg py-1 text-sm text-muted hover:text-ink lg:hidden"><ArrowLeft className="size-4 shrink-0 rtl:rotate-180" aria-hidden /><span className="truncate">{title}</span></Link>}
          {current && <span className={cn("hidden min-w-0 items-center gap-2 truncate text-sm lg:flex")}>{currentGroup?.key && <><span className="text-muted">{t(currentGroup.key)}</span><span className="text-muted/50" aria-hidden>/</span></>}{onSubPage ? <Link href={current.href} className="truncate text-muted hover:text-ink">{title}</Link> : <span className="truncate font-semibold">{title}</span>}</span>}
          <div className="ms-auto flex items-center gap-2 sm:gap-3">
            {showWallet && w && !managed && <Link href={`${base}/wallet`} aria-label={`${t(user.role === "business" ? "nav.wallet" : "nav.earnings")}: ${fmtMoney(w.availableCents, locale)}`} className={cn("flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold", w.availableCents < 0 ? "border-danger/40 bg-danger/10 text-danger" : "border-gold/40 bg-gold/10 text-gold")}><Wallet className="size-4" aria-hidden /><span className="ltr-num tabular-nums">{fmtMoney(w.availableCents, locale)}</span></Link>}
            <LanguageSwitcher compact />
            <Link href={`${base}/notifications`} className="jr-tap relative flex items-center justify-center rounded-xl border border-line p-2 text-muted hover:text-ink" aria-label={(badges.notifications ?? 0) > 0 ? `${t("nav.notifications")} (${badges.notifications})` : t("nav.notifications")}>
              <Bell className="size-[18px]" aria-hidden />{(badges.notifications ?? 0) > 0 && <span aria-hidden className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">{(badges.notifications ?? 0) > 9 ? "9+" : badges.notifications}</span>}
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
      <JumpDialog open={jump} onClose={() => setJump(false)} groups={groups} onGo={(href) => router.push(href)} />
    </div>
  );
}
