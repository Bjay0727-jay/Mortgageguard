"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Input, authGradient } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      router.push(u.mustChangePassword ? "/change-password" : "/dashboard");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: authGradient }}>
      <div className="w-full max-w-[400px] rounded-[18px] bg-white px-10 py-11 shadow-[0_25px_50px_-12px_rgba(0,0,0,.25)]">
        {/* Logo */}
        <div className="mb-2 flex items-center justify-center gap-3">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-[var(--grn)] text-base font-bold text-white">
            MG
          </div>
          <span className="text-xl font-bold text-[var(--royal)]">MortgageGuard</span>
        </div>
        <p className="mb-8 text-center text-sm text-[var(--gray-400)]">Multi-state compliance CRM</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="rounded-[10px] bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">
              {error}
            </div>
          )}

          <Input
            type="email"
            label="Email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />

          <Input
            type="password"
            label="Password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
          />

          {/* Remember me + Forgot password */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-[var(--gray-600)]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--royal)]"
              />
              Remember me
            </label>
            <Link href="#" className="text-sm font-medium text-[var(--royal-lt)]">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" fullWidth loading={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--gray-500)]">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-[var(--royal)]">
            Register
          </Link>
        </p>

        {/* Encryption footer */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[var(--gray-400)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span className="text-xs">Protected by 256-bit encryption</span>
        </div>
      </div>
    </div>
  );
}
