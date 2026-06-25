"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Company Admin",
  qualifying_individual: "Qualifying Individual",
  loan_originator: "Loan Originator",
  processor: "Processor",
  compliance_officer: "Compliance Officer",
  read_only: "Read Only",
};

interface InviteDetails {
  email: string;
  role: string;
  companyName: string;
  expiresAt: string;
}

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const { getInvite, registerWithInvite } = useAuth();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [checking, setChecking] = useState(true);

  const [form, setForm] = useState({ name: "", password: "", confirm: "", nmlsId: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getInvite(token);
        if (active) setInvite(data);
      } catch (err: any) {
        if (active) setLoadError(err.message || "This invitation is not valid.");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, getInvite]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await registerWithInvite({
        token,
        name: form.name,
        password: form.password,
        nmlsId: form.nmlsId || undefined,
      });
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Could not complete registration");
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

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: "linear-gradient(135deg, #122B52 0%, #1B3A6B 40%, #2B5298 100%)" }}
    >
      <div
        className="w-full"
        style={{ maxWidth: 400, backgroundColor: "#fff", borderRadius: 18, padding: "44px 40px", boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }}
      >
        <div className="mb-6 flex items-center justify-center gap-3">
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

        {checking && <p className="text-center text-sm text-gray-400">Validating invitation…</p>}

        {!checking && loadError && (
          <div className="space-y-4 text-center">
            <div className="text-sm" style={{ backgroundColor: "#FEF0EF", color: "#C4302B", borderRadius: 10, padding: "12px 14px" }}>
              {loadError}
            </div>
            <p className="text-sm text-gray-500">
              Ask your company admin to send a new invitation, or{" "}
              <a href="/login" className="font-medium" style={{ color: "#1B3A6B" }}>
                sign in
              </a>
              .
            </p>
          </div>
        )}

        {!checking && invite && (
          <>
            <p className="mb-1 text-center text-sm font-medium" style={{ color: "#1B3A6B" }}>
              Join {invite.companyName}
            </p>
            <p className="mb-6 text-center text-xs text-gray-400">
              {invite.email} · {ROLE_LABELS[invite.role] || invite.role}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="text-sm" style={{ backgroundColor: "#FEF0EF", color: "#C4302B", borderRadius: 10, padding: "10px 14px" }}>
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
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
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
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
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
                  value={form.confirm}
                  onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                  className="w-full text-sm outline-none"
                  style={inputStyle}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium" style={{ color: "#1B3A6B" }}>
                  NMLS ID (optional)
                </label>
                <input
                  type="text"
                  value={form.nmlsId}
                  onChange={(e) => setForm((f) => ({ ...f, nmlsId: e.target.value }))}
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
                {submitting ? "Creating account…" : "Accept Invitation"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
