"use client";

import Link from "next/link";
import { authGradient } from "@/components/ui";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: authGradient }}>
      <div className="w-full max-w-[460px] rounded-[18px] bg-white px-10 py-11 text-center shadow-[0_25px_50px_-12px_rgba(0,0,0,.25)]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-[var(--grn)] text-base font-bold text-white">MG</div>
          <span className="text-xl font-bold text-[var(--royal)]">MortgageGuard</span>
        </div>
        <h1 className="text-2xl font-bold text-[var(--royal)]">Registration is invite-only</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--gray-600)]">
          For security, MortgageGuard accounts must be created from an invitation sent by your company administrator. Invitation links include your company and assigned role, so users cannot choose privileged access during signup.
        </p>
        <div className="mt-8 space-y-3">
          <Link href="/login" className="block rounded-lg bg-[var(--royal)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--royal-lt)]">Back to Sign In</Link>
          <p className="text-xs text-[var(--gray-400)]">Have an invite link? Open it from your email or ask your admin to resend it.</p>
        </div>
      </div>
    </div>
  );
}
