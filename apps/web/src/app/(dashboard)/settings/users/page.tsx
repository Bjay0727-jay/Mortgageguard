import Link from "next/link";

export default function Page() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0F7B46]">Settings</p>
        <h1 className="mt-2 text-2xl font-bold text-[#1B3A6B]">Users & Invites</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">Invite team members and manage role-based access to MortgageGuard.</p>
      </div>
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <div className="text-3xl">⚙️</div>
        <p className="mt-3 text-sm text-gray-600">Invite management workflows will be connected here.</p>
        <Link href="/dashboard" className="mt-4 inline-flex rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298]">Back to Dashboard</Link>
      </div>
    </div>
  );
}
