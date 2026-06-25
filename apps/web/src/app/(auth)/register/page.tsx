"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    companyName: "",
    nmlsId: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        companyName: form.companyName,
        nmlsId: form.nmlsId || undefined,
      });
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 14px",
    transition: "border-color .15s, box-shadow .15s",
  };

  function onFocus(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "#1B3A6B";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(27,58,107,.12)";
  }

  function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
    e.currentTarget.style.borderColor = "#d1d5db";
    e.currentTarget.style.boxShadow = "none";
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{
        background:
          "linear-gradient(135deg, #122B52 0%, #1B3A6B 40%, #2B5298 100%)",
      }}
    >
      <div
        className="w-full"
        style={{
          maxWidth: 400,
          backgroundColor: "#fff",
          borderRadius: 18,
          padding: "44px 40px",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)",
        }}
      >
        {/* Logo */}
        <div className="mb-2 flex items-center justify-center gap-3">
          <div
            className="flex items-center justify-center font-bold text-white"
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              backgroundColor: "#0F7B46",
              fontSize: 16,
            }}
          >
            MG
          </div>
          <span className="text-xl font-bold" style={{ color: "#1B3A6B" }}>
            MortgageGuard
          </span>
        </div>
        <p className="mb-2 text-center text-sm text-gray-400">
          Create your company workspace
        </p>
        <p className="mb-8 text-center text-xs text-gray-400">
          You'll be the company administrator. Team members join by invitation.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              className="text-sm"
              style={{
                backgroundColor: "#FEF0EF",
                color: "#C4302B",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Full Name
            </label>
            <input
              type="text"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Company Name
            </label>
            <input
              type="text"
              required
              value={form.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="Your mortgage company"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="Min 8 characters"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Confirm Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="Re-enter password"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
              NMLS ID (optional)
            </label>
            <input
              type="text"
              value={form.nmlsId}
              onChange={(e) => update("nmlsId", e.target.value)}
              className="w-full text-sm outline-none"
              style={inputStyle}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full font-semibold text-white disabled:opacity-50"
            style={{
              backgroundColor: "#1B3A6B",
              borderRadius: 10,
              padding: "12px 16px",
              fontSize: 14,
              transition: "background-color .15s",
              cursor: loading ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.backgroundColor = "#2B5298";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#1B3A6B";
            }}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium" style={{ color: "#1B3A6B" }}>
            Sign In
          </Link>
        </p>

        {/* Encryption footer */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-gray-400">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span className="text-xs">Protected by 256-bit encryption</span>
        </div>
      </div>
    </div>
  );
}
