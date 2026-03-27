"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

/* ── Route title map ── */
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/loans": "Loans",
  "/programs": "Programs",
  "/reports": "Reports",
  "/integrations": "Integrations",
};

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  const pageTitle =
    PAGE_TITLES[pathname] ||
    Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] ||
    "MortgageGuard";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top Header Bar ── */}
        <header
          className="flex shrink-0 items-center justify-between"
          style={{
            backgroundColor: "#fff",
            borderBottom: "1px solid #e5e7eb",
            padding: "12px 24px",
          }}
        >
          {/* Left: Page title */}
          <h2
            className="text-lg font-semibold"
            style={{ color: "#1B3A6B" }}
          >
            {pageTitle}
          </h2>

          {/* Right: controls */}
          <div className="flex items-center gap-3">
            {/* State filter dropdown */}
            <select
              className="text-sm outline-none"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "6px 10px",
                color: "#374151",
                backgroundColor: "#fff",
              }}
              defaultValue=""
            >
              <option value="">All States</option>
              <option value="CA">California</option>
              <option value="TX">Texas</option>
              <option value="FL">Florida</option>
              <option value="NY">New York</option>
              <option value="IL">Illinois</option>
            </select>

            {/* Search input */}
            <div className="relative">
              <svg
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm outline-none"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "6px 10px 6px 28px",
                  width: 200,
                  transition: "border-color .15s, box-shadow .15s",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#1B3A6B";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(27,58,107,.08)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Notification bell */}
            <button
              className="relative flex items-center justify-center"
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                backgroundColor: "#fff",
                color: "#6b7280",
                cursor: "pointer",
                transition: "background-color .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f9fafb";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#fff";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              {/* Red dot indicator */}
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: "#C4302B",
                  border: "2px solid #fff",
                }}
              />
            </button>
          </div>
        </header>

        {/* ── Content area ── */}
        <main
          className="flex-1 overflow-y-auto"
          style={{
            backgroundColor: "#f9fafb",
            padding: 24,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
