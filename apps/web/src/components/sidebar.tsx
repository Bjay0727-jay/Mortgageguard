"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "\u2302" },
  { href: "/dashboard/loans", label: "Loans", icon: "\u2637" },
  { href: "/dashboard/programs", label: "Programs", icon: "\u2611" },
  { href: "/dashboard/reports", label: "Reports", icon: "\u2630" },
  { href: "/dashboard/integrations", label: "Integrations", icon: "\u2194" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-200 bg-[#1B3A6B] text-white">
      {/* Logo */}
      <div className="px-5 py-5">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          MortgageGuard
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      {user && (
        <div className="border-t border-white/20 px-4 py-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-white/60">{user.companyName}</p>
          <button
            onClick={logout}
            className="mt-3 w-full rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
          >
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
