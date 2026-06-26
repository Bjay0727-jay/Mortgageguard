"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Input, authGradient } from "@/components/ui";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, loading, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Not signed in → nothing to change.
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  const forced = !!user?.mustChangePassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(newPassword, forced ? undefined : currentPassword);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: authGradient }}
    >
      <div className="w-full max-w-[400px] rounded-[18px] bg-white px-10 py-11 shadow-[0_25px_50px_-12px_rgba(0,0,0,.25)]">
        <div className="mb-2 flex items-center justify-center gap-3">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-[var(--grn)] text-base font-bold text-white">
            MG
          </div>
          <span className="text-xl font-bold text-[var(--royal)]">MortgageGuard</span>
        </div>
        <p className="mb-2 text-center text-sm font-medium text-[var(--royal)]">
          {forced ? "Change default admin password" : "Change password"}
        </p>
        <p className="mb-8 text-center text-xs text-[var(--gray-400)]">
          {forced
            ? "Default administrator credentials are for initial setup only. Set a new password before continuing."
            : "Update the password for your account."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-[10px] bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">
              {error}
            </div>
          )}

          {!forced && (
            <Input
              type="password"
              label="Current Password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          )}

          <Input
            type="password"
            label="New Password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min 8 characters"
          />

          <Input
            type="password"
            label="Confirm New Password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <Button type="submit" fullWidth loading={submitting}>
            {submitting ? "Saving…" : "Update Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
