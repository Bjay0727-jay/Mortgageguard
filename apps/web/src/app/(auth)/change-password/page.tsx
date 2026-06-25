"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

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

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 14px",
    transition: "border-color .15s, box-shadow .15s",
  };
  function onFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "#1B3A6B";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(27,58,107,.12)";
  }
  function onBlur(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "#d1d5db";
    e.currentTarget.style.boxShadow = "none";
  }

  if (loading || !user) return null;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: "linear-gradient(135deg, #122B52 0%, #1B3A6B 40%, #2B5298 100%)" }}
    >
      <div
        className="w-full"
        style={{ maxWidth: 400, backgroundColor: "#fff", borderRadius: 18, padding: "44px 40px", boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }}
      >
        <div className="mb-2 flex items-center justify-center gap-3">
          <div
            className="flex items-center justify-center font-bold text-white"
            style={{ width: 42, height: 42, borderRadius: 10, backgroundColor: "#0F7B46", fontSize: 16 }}
          >
            MG
          </div>
          <span className="text-xl font-bold" style={{ color: "#1B3A6B" }}>
            MortgageGuard
          </span>
        </div>
        <p className="mb-2 text-center text-sm font-medium" style={{ color: "#1B3A6B" }}>
          {forced ? "Change default admin password" : "Change password"}
        </p>
        <p className="mb-8 text-center text-xs text-gray-400">
          {forced
            ? "Default administrator credentials are for initial setup only. Set a new password before continuing."
            : "Update the password for your account."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm" style={{ backgroundColor: "#FEF0EF", color: "#C4302B", borderRadius: 10, padding: "10px 14px" }}>
              {error}
            </div>
          )}

          {!forced && (
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
                Current Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full text-sm outline-none"
                style={inputStyle}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="Min 8 characters"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Confirm New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "#1B3A6B", borderRadius: 10, padding: "12px 16px", fontSize: 14, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Saving..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
