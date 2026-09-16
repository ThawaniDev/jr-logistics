import { NavLink, Link, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import api from "@/lib/api";
import {
  LayoutDashboard, ClipboardList, PlusCircle, Wallet, LifeBuoy, Building2,
  Zap, Briefcase, User, Users, Banknote, Bell, LogOut, Menu, X, ShieldCheck, Settings,
} from "lucide-react";
import { sar, roleHome } from "@/lib/constants";

const NAVS = {
  business: [
    { to: "/app/business", label: "لوحة التحكم", icon: LayoutDashboard, end: true },
    { to: "/app/business/requests", label: "طلباتي", icon: ClipboardList },
    { to: "/app/business/requests/new", label: "طلب جديد", icon: PlusCircle },
    { to: "/app/business/wallet", label: "المحفظة", icon: Wallet },
    { to: "/app/notifications", label: "الإشعارات", icon: Bell },
    { to: "/app/support", label: "الدعم والمساندة", icon: LifeBuoy },
    { to: "/app/business/profile", label: "الملف التجاري", icon: Building2 },
  ],
  worker: [
    { to: "/app/worker", label: "لوحة التحكم", icon: LayoutDashboard, end: true },
    { to: "/app/worker/opportunities", label: "الفرص المتاحة", icon: Zap },
    { to: "/app/worker/jobs", label: "مهامي", icon: Briefcase },
    { to: "/app/worker/wallet", label: "المحفظة والأرباح", icon: Wallet },
    { to: "/app/notifications", label: "الإشعارات", icon: Bell },
    { to: "/app/support", label: "الدعم والمساندة", icon: LifeBuoy },
    { to: "/app/worker/profile", label: "ملفي الشخصي", icon: User },
  ],
  admin: [
    { to: "/app/admin", label: "لوحة التحكم", icon: LayoutDashboard, end: true },
    { to: "/app/admin/users", label: "المستخدمون", icon: Users },
    { to: "/app/admin/requests", label: "الطلبات والمطابقة", icon: ClipboardList },
    { to: "/app/admin/withdrawals", label: "طلبات السحب", icon: Banknote },
    { to: "/app/admin/settings", label: "التسعير والإعدادات", icon: Settings },
    { to: "/app/notifications", label: "الإشعارات", icon: Bell },
    { to: "/app/admin/support", label: "الدعم والشكاوى", icon: LifeBuoy },
  ],
};

export default function DashboardLayout() {
  const { user, wallet, loading, logout, refresh } = useAuth();
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    api.get("/notifications").then(({ data }) => setUnread(data.unread)).catch(() => {});
    const t = setInterval(() => {
      api.get("/notifications").then(({ data }) => setUnread(data.unread)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-900">
        <div className="flex flex-col items-center gap-4">
          <ShieldCheck className="w-10 h-10 text-brand animate-pulse-soft" />
          <p className="text-slate-400 text-sm">جاري تحميل منصة إسناد…</p>
        </div>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;

  const nav = NAVS[user.role] || [];

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link to="/" className="flex items-center gap-3 px-5 py-6 border-b border-navy-600/50" data-testid="sidebar-logo">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(0,229,163,0.35)]">
          <span className="font-heading font-black text-navy-900 text-lg">إ</span>
        </div>
        <div>
          <p className="font-heading font-extrabold text-lg leading-none">إسناد</p>
          <p className="text-[11px] text-slate-500 mt-1">الموارد اللوجستية والتشغيلية</p>
        </div>
      </Link>
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            data-testid={`nav-${item.to.replace(/\//g, "-").slice(1)}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-brand/10 text-brand border border-brand/25 shadow-[0_0_18px_rgba(0,229,163,0.08)]"
                  : "text-slate-400 hover:text-slate-100 hover:bg-navy-700/50 border border-transparent"
              }`
            }
          >
            <item.icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            {item.label}
            {item.label === "الإشعارات" && unread > 0 && (
              <span className="ms-auto bg-brand text-navy-900 text-[10px] font-bold rounded-full px-2 py-0.5 num" data-testid="nav-unread-badge">
                {unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-navy-600/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-navy-700 border border-navy-600 flex items-center justify-center font-heading font-bold text-brand">
            {user.name?.[0] || "؟"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{user.name}</p>
            <p className="text-[11px] text-slate-500 num truncate">{user.phone}</p>
          </div>
          <button
            data-testid="logout-btn"
            onClick={async () => { await logout(); navigate("/"); }}
            className="text-slate-500 hover:text-rose-400 transition-colors"
            title="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-navy-900 text-slate-100 flex">
      <aside className="hidden lg:block w-64 shrink-0 border-e border-navy-600/50 bg-navy-850/60 backdrop-blur-xl sticky top-0 h-screen">
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute top-0 right-0 h-full w-72 bg-navy-850 border-s border-navy-600/50 shadow-2xl">
            <button className="absolute top-5 left-4 text-slate-400" onClick={() => setMobileOpen(false)} data-testid="mobile-menu-close">
              <X className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 glass border-x-0 border-t-0 flex items-center gap-4 px-4 sm:px-6 py-3">
          <button className="lg:hidden text-slate-300" onClick={() => setMobileOpen(true)} data-testid="mobile-menu-open">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          {user.role !== "admin" && wallet && (
            <Link
              to={user.role === "business" ? "/app/business/wallet" : "/app/worker/wallet"}
              data-testid="header-wallet-chip"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-brand/10 border border-brand/25 text-brand text-sm font-semibold hover:bg-brand/15 transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span className="num">{sar(wallet.available)}</span>
            </Link>
          )}
          <Link to="/app/notifications" className="relative text-slate-300 hover:text-brand transition-colors" data-testid="header-bell">
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-1.5 -left-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 num">
                {unread}
              </span>
            )}
          </Link>
          <button onClick={refresh} className="hidden" data-testid="refresh-auth" />
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
