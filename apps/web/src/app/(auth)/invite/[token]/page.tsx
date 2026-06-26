"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Input, authGradient } from "@/components/ui";

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

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ background: authGradient }}>
      <div className="w-full max-w-[400px] rounded-[18px] bg-white px-10 py-11 shadow-[0_25px_50px_-12px_rgba(0,0,0,.25)]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] bg-[var(--grn)] text-base font-bold text-white">MG</div>
          <span className="text-xl font-bold text-[var(--royal)]">MortgageGuard</span>
        </div>

        {checking && <p className="text-center text-sm text-[var(--gray-400)]">Validating invitation…</p>}

        {!checking && loadError && (
          <div className="space-y-4 text-center">
            <div role="alert" className="rounded-[10px] bg-[var(--red-pl)] px-3.5 py-3 text-sm text-[var(--red)]">
              {loadError}
            </div>
            <p className="text-sm text-[var(--gray-500)]">
              Ask your company admin to send a new invitation, or{" "}
              <a href="/login" className="font-medium text-[var(--royal)]">
                sign in
              </a>
              .
            </p>
          </div>
        )}

        {!checking && invite && (
          <>
            <p className="mb-1 text-center text-sm font-medium text-[var(--royal)]">Join {invite.companyName}</p>
            <p className="mb-6 text-center text-xs text-[var(--gray-400)]">
              {invite.email} · {ROLE_LABELS[invite.role] || invite.role}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-[10px] bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">
                  {error}
                </div>
              )}

              <Input
                type="text"
                label="Full Name"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />

              <Input
                type="password"
                label="Password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min 8 characters"
              />

              <Input
                type="password"
                label="Confirm Password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
              />

              <Input
                type="text"
                label="NMLS ID (optional)"
                value={form.nmlsId}
                onChange={(e) => setForm((f) => ({ ...f, nmlsId: e.target.value }))}
              />

              <Button type="submit" fullWidth loading={submitting}>
                {submitting ? "Creating account…" : "Accept Invitation"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
