"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useCapabilities } from "@/lib/capabilities";
import { Sidebar } from "@/components/sidebar";
import { isDefaultAdmin } from "@/lib/dashboard-setup";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/loans": "Loans",
  "/programs": "Programs",
  "/reports": "Reports",
  "/integrations": "Integrations",
  "/settings/company": "Company Settings",
  "/settings/users": "Users & Invites",
  "/settings/audit": "Audit Log",
  "/settings/profile": "Profile",
};

function getInitials(name: string): string {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { can } = useCapabilities();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    } else if (!loading && user?.mustChangePassword) {
      router.push("/change-password");
    }
  }, [user, loading, router]);

  const notifications = useMemo(() => {
    if (!user) return [];
    const items = [];
    if (isDefaultAdmin(user)) items.push({ title: "Default admin password should be changed", href: "/change-password" });
    items.push({ title: "Required programs missing", href: "/programs" });
    items.push({ title: "No reporting deadlines configured", href: "/reports" });
    items.push({ title: "Texas rules may not be loaded", href: "/settings/company?tab=rules" });
    return items;
  }, [user]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!user) return null;

  const pageTitle = PAGE_TITLES[pathname] || Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] || "MortgageGuard";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <h2 className="text-lg font-semibold text-[#1B3A6B]">{pageTitle}</h2>
            <p className="text-xs text-gray-400">Guided compliance operations</p>
          </div>

          <div className="flex items-center gap-3">
            <select className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none" defaultValue="">
              <option value="">All States</option>
              <option value="TX">Texas</option>
              <option value="CA">California</option>
              <option value="FL">Florida</option>
              <option value="NY">New York</option>
              <option value="IL">Illinois</option>
            </select>

            <div className="relative hidden sm:block">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-[220px] rounded-lg border border-gray-200 px-3 py-2 pl-8 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10" />
            </div>

            <div className="relative">
              <button aria-label="Notifications" onClick={() => setNotificationsOpen((open) => !open)} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
                {notifications.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#C4302B] ring-2 ring-white" />}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
                  <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Notifications</p>
                  {notifications.length === 0 ? (
                    <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500">No notifications yet. Compliance alerts will appear here.</p>
                  ) : (
                    <div className="space-y-1">
                      {notifications.map((item) => (
                        <Link key={item.title} href={item.href} onClick={() => setNotificationsOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-[#E8EEF7]">
                          {item.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <button onClick={() => setUserMenuOpen((open) => !open)} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B3A6B] text-xs font-bold text-white">{getInitials(user.name)}</span>
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-semibold text-gray-900">{user.name}</span>
                  <span className="block text-[10px] text-gray-500">{user.role}</span>
                </span>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                  <MenuLink href="/settings/profile" label="Profile" onClick={() => setUserMenuOpen(false)} />
                  <MenuLink href="/settings/company" label="Company Settings" onClick={() => setUserMenuOpen(false)} />
                  <MenuLink href="/change-password" label="Change Password" onClick={() => setUserMenuOpen(false)} />
                  {can("manageInvites") && <MenuLink href="/settings/users" label="Manage Users / Invites" onClick={() => setUserMenuOpen(false)} />}
                  <button onClick={() => { setUserMenuOpen(false); logout(); }} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">Sign Out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">{children}</main>
      </div>
    </div>
  );
}

function MenuLink({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return <Link href={href} onClick={onClick} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-[#E8EEF7]">{label}</Link>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
