"use client";

import Link from "next/link";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: "linear-gradient(135deg, #122B52 0%, #1B3A6B 40%, #2B5298 100%)" }}>
      <div className="w-full text-center" style={{ maxWidth: 460, backgroundColor: "#fff", borderRadius: 18, padding: "44px 40px", boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }}>
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex items-center justify-center font-bold text-white" style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: "#0F7B46", fontSize: 16 }}>MG</div>
          <span className="text-xl font-bold" style={{ color: "#1B3A6B" }}>MortgageGuard</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: "#1B3A6B" }}>Registration is invite-only</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          For security, MortgageGuard accounts must be created from an invitation sent by your company administrator. Invitation links include your company and assigned role, so users cannot choose privileged access during signup.
        </p>
        <div className="mt-8 space-y-3">
          <Link href="/login" className="block rounded-lg bg-[#1B3A6B] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2B5298]">Back to Sign In</Link>
          <p className="text-xs text-gray-400">Have an invite link? Open it from your email or ask your admin to resend it.</p>
        </div>
      </div>
    </div>
  );
}
