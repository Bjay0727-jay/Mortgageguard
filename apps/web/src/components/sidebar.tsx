"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

/* ── SVG icon components (20×20) ─────────────────────── */

function IconDashboard() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity=".55" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".55" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity=".35" />
    </svg>
  );
}

function IconLoans() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <path
        d="M4 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z"
        fill="currentColor"
        opacity=".25"
      />
      <path
        d="M7 7h6M7 10h6M7 13h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPrograms() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m7 10 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconReports() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <rect x="3" y="11" width="3" height="6" rx="1" fill="currentColor" opacity=".45" />
      <rect x="8.5" y="7" width="3" height="10" rx="1" fill="currentColor" opacity=".65" />
      <rect x="14" y="3" width="3" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconIntegrations() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <circle cx="7" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 10h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 10h2.5M15.5 10H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Nav structure with sections ─────────────────────── */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Main",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <IconDashboard /> },
      { href: "/loans", label: "Loans", icon: <IconLoans /> },
    ],
  },
  {
    title: "Compliance",
    items: [
      { href: "/programs", label: "Programs", icon: <IconPrograms /> },
      { href: "/reports", label: "Reports", icon: <IconReports /> },
    ],
  },
  {
    title: "Integrations",
    items: [
      { href: "/integrations", label: "Integrations", icon: <IconIntegrations /> },
    ],
  },
];

/* ── Helper: get user initials ───────────────────────── */

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ── Sidebar component ───────────────────────────────── */

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside
      className="flex h-screen flex-col"
      style={{
        width: 230,
        minWidth: 230,
        background: "var(--royal)",
        color: "#fff",
      }}
    >
      {/* Logo area */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div
          className="flex items-center justify-center rounded-lg text-sm font-bold"
          style={{
            width: 32,
            height: 32,
            background: "var(--grn)",
            color: "#fff",
            borderRadius: "var(--radius-md)",
          }}
        >
          MG
        </div>
        <Link href="/dashboard" className="block">
          <span className="block text-sm font-bold leading-tight tracking-tight text-white">
            MortgageGuard
          </span>
          <span
            className="block text-[10px] font-medium leading-tight"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            Compliance CRM
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="sidebar-section-header">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors"
                    style={{
                      background: active ? "rgba(255,255,255,0.15)" : "transparent",
                      color: active ? "#fff" : "rgba(255,255,255,0.5)",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.85)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                      }
                    }}
                  >
                    <span className="flex-shrink-0" style={{ width: 20, height: 20 }}>
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge != null && (
                      <span
                        className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                        style={{
                          background: "rgba(255,255,255,0.15)",
                          color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section */}
      {user && (
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-4 py-3.5 transition-colors"
          style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {/* Initials avatar */}
          <div
            className="flex items-center justify-center rounded-full text-[11px] font-bold"
            style={{
              width: 32,
              height: 32,
              background: "var(--royal-lt)",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {getInitials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight text-white">
              {user.name}
            </p>
            <p
              className="truncate text-[11px] leading-tight"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {user.role || user.companyName}
            </p>
          </div>
        </Link>
      )}
    </aside>
  );
}
