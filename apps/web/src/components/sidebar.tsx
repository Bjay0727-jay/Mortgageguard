"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useCapabilities } from "@/lib/capabilities";
import { cn } from "@/components/ui";
import type { Capability } from "@mortgageguard/shared";

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


function IconSettings() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 20 20">
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16.2 11.5a6.7 6.7 0 0 0 0-3l1.1-.8-1.5-2.6-1.3.5a6.4 6.4 0 0 0-2.6-1.5L11.7 2H8.3l-.2 2.1a6.4 6.4 0 0 0-2.6 1.5l-1.3-.5-1.5 2.6 1.1.8a6.7 6.7 0 0 0 0 3l-1.1.8 1.5 2.6 1.3-.5a6.4 6.4 0 0 0 2.6 1.5l.2 2.1h3.4l.2-2.1a6.4 6.4 0 0 0 2.6-1.5l1.3.5 1.5-2.6-1.1-.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Nav structure with sections ─────────────────────── */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
  capability: Capability;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Main",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <IconDashboard />, capability: "viewDashboard" },
      { href: "/loans", label: "Loans", icon: <IconLoans />, capability: "viewLoans" },
    ],
  },
  {
    title: "Compliance",
    items: [
      { href: "/programs", label: "Programs", icon: <IconPrograms />, capability: "viewCompliancePrograms" },
      { href: "/reports", label: "Reports", icon: <IconReports />, capability: "viewReports" },
      { href: "/evidence-packets", label: "Evidence Packets", icon: <IconReports />, capability: "viewEvidencePackets" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { href: "/integrations", label: "Integrations", icon: <IconIntegrations />, capability: "viewIntegrations" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/company-settings", label: "Company Settings", icon: <IconSettings />, capability: "manageUsers" },
      { href: "/users", label: "Users", icon: <IconSettings />, capability: "manageInvites" },
      { href: "/settings/audit", label: "Audit Log", icon: <IconSettings />, capability: "viewAuditTrail" },
      { href: "/admin/outbox", label: "Audit Outbox", icon: <IconSettings />, capability: "viewOutbox" },
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

interface SidebarProps {
  /** Drawer open state on tablet/mobile. Ignored at lg+ (always visible). */
  open?: boolean;
  /** Called to close the drawer (backdrop tap, close button, nav tap). */
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { can } = useCapabilities();

  return (
    <>
      {/* Backdrop — mobile/tablet only, while the drawer is open */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
        onClick={onClose}
      />

      <aside
        aria-label="Primary"
        className={cn(
          // Mobile/tablet: fixed slide-in drawer. Desktop (lg+): static column.
          "fixed inset-y-0 left-0 z-50 flex h-screen w-[230px] min-w-[230px] flex-col bg-[var(--royal)] text-white shadow-xl transition-transform duration-200 ease-out",
          "lg:static lg:z-auto lg:shadow-none lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo area + mobile close button */}
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--grn)] text-sm font-bold text-white">
            MG
          </div>
          <Link href="/dashboard" className="block" onClick={onClose}>
            <span className="block text-sm font-bold leading-tight tracking-tight text-white">
              MortgageGuard
            </span>
            <span className="block text-[10px] font-medium leading-tight text-white/45">
              Compliance CRM
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter((item) => can(item.capability));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.title}>
                <div className="sidebar-section-header">{section.title}</div>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const active =
                      item.href === "/dashboard"
                        ? pathname === "/dashboard"
                        : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                          active
                            ? "bg-white/15 text-white"
                            : "text-white/50 hover:bg-white/10 hover:text-white/90",
                        )}
                      >
                        <span className="h-5 w-5 flex-shrink-0">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge != null && (
                          <span className="ml-auto rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white/70">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User section */}
        {user && (
          <Link
            href="/dashboard"
            onClick={onClose}
            className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3.5 transition-colors hover:bg-white/[0.06]"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--royal-lt)] text-[11px] font-bold text-white">
              {getInitials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight text-white">{user.name}</p>
              <p className="truncate text-[11px] leading-tight text-white/45">{user.role || user.companyName}</p>
            </div>
          </Link>
        )}
      </aside>
    </>
  );
}
