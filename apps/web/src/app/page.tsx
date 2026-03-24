import Link from "next/link";
import { BRAND } from "@mortgageguard/shared";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header
        className="px-6 py-4 text-white"
        style={{ backgroundColor: BRAND.royal }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">MortgageGuard</h1>
          <nav className="flex gap-4">
            <Link href="/login" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-white/10">
              Sign In
            </Link>
            <Link
              href="/register"
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: BRAND.green }}
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <h2 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl"
            style={{ color: BRAND.royal }}>
          Multi-State Mortgage Compliance, Simplified
        </h2>
        <p className="mt-6 max-w-2xl text-lg text-gray-600">
          Dynamically generate loan-level compliance checklists based on state,
          loan type, and purpose. Real-time examination readiness scoring for
          brokers, lenders, and servicers.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/register"
            className="rounded-lg px-6 py-3 text-base font-semibold text-white shadow-sm"
            style={{ backgroundColor: BRAND.royal }}
          >
            Start Free Trial
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Sign In
          </Link>
        </div>

        {/* Feature highlights */}
        <div className="mx-auto mt-20 grid max-w-5xl gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl">&#128203;</div>
            <h3 className="text-lg font-semibold" style={{ color: BRAND.royal }}>
              Dynamic Checklists
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Auto-generated compliance checklists based on state rules, loan
              purpose, and product type. Federal + state requirements merged.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl">&#128200;</div>
            <h3 className="text-lg font-semibold" style={{ color: BRAND.royal }}>
              Exam Readiness Score
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Real-time weighted compliance scores per loan. Pipeline gates
              prevent stage advancement without required documents.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm">
            <div className="mb-3 text-2xl">&#128279;</div>
            <h3 className="text-lg font-semibold" style={{ color: BRAND.royal }}>
              LOS Integrations
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Connect Encompass, Calyx Point, LendingPad, and more. Bi-directional
              sync keeps your compliance data current.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 px-6 py-6 text-center text-sm text-gray-500">
        &copy; {new Date().getFullYear()} MortgageGuard. All rights reserved.
      </footer>
    </div>
  );
}
