"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import type { BackendSetupStatus } from "@/lib/dashboard-setup";
import { Badge, Button, Card, PageHeader, useToast, type BadgeVariant } from "@/components/ui";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  complete: "green",
  warning: "amber",
  incomplete: "amber",
  blocked: "red",
  optional: "gray",
};

export default function SetupPage() {
  const [status, setStatus] = useState<BackendSetupStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { can } = useCapabilities();
  const { toast } = useToast();

  const load = useCallback(() => {
    setError("");
    api.get<BackendSetupStatus>("/api/v1/setup/status").then(setStatus).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function loadRules() {
    setBusy("rules");
    try {
      await api.post("/api/v1/setup/load-rules", { state: "TX" });
      toast({ variant: "success", title: "Texas rules loaded", description: "Compliance rules and required documents are ready." });
      load();
    } catch (e: any) {
      toast({ variant: "error", title: "Could not load rules", description: e.message });
    } finally { setBusy(null); }
  }

  async function setupPrograms() {
    setBusy("programs");
    try {
      await api.post("/api/v1/programs/setup-required", {});
      toast({ variant: "success", title: "Programs set up", description: "Required compliance programs are seeded." });
      load();
    } catch (e: any) {
      toast({ variant: "error", title: "Could not set up programs", description: e.message });
    } finally { setBusy(null); }
  }

  if (error && !status) {
    return (
      <Card className="text-center">
        <p className="text-sm text-[var(--red)]">{error}</p>
        <Button className="mt-3" onClick={load}>Retry</Button>
      </Card>
    );
  }
  if (!status) return <p className="text-[var(--gray-500)]">Loading setup status…</p>;

  const required = status.steps.filter((s) => s.required);
  const optional = status.steps.filter((s) => !s.required);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setup"
        description={status.coreSetupComplete ? "Core setup complete — your workspace is exam-ready." : "Complete these steps to power checklists, scoring, and reporting."}
        actions={<Button variant="secondary" onClick={load}>Re-check status</Button>}
      />

      {/* Progress */}
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--royal)]">Setup progress</p>
          <span className="text-sm text-[var(--gray-600)]">{status.progress.completed} of {status.progress.total} required steps</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--gray-200)]">
          <div className="h-full rounded-full bg-[var(--grn)]" style={{ width: `${status.progress.percent}%` }} />
        </div>
      </Card>

      {/* Warnings */}
      {status.warnings.length > 0 && (
        <div className="space-y-2">
          {status.warnings.map((w) => (
            <div key={w.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm ${w.severity === "critical" ? "bg-[var(--red-pl)] text-[var(--red)]" : "bg-[var(--amb-pl)] text-[var(--amb)]"}`}>
              <span><strong>{w.title}.</strong> {w.message}</span>
              <Link href={w.actionHref} className="font-semibold underline">{w.actionLabel}</Link>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <Card className="flex flex-wrap items-center gap-2">
        <span id="rules" className="text-sm font-medium text-[var(--gray-700)]">Quick actions:</span>
        {can("loadComplianceRules") && <Button size="sm" loading={busy === "rules"} onClick={loadRules}>Load Texas Rules</Button>}
        {can("manageCompliancePrograms") && <Button id="programs" size="sm" variant="secondary" loading={busy === "programs"} onClick={setupPrograms}>Set up required programs</Button>}
        <Link href="/company-settings"><Button size="sm" variant="ghost">Company Settings</Button></Link>
        <Link href="/users"><Button size="sm" variant="ghost">Users</Button></Link>
        <Link href="/programs"><Button size="sm" variant="ghost">Programs</Button></Link>
        <Link href="/integrations"><Button size="sm" variant="ghost">Integrations</Button></Link>
      </Card>

      <StepList title="Required steps" steps={required} />
      <StepList title="Optional steps" steps={optional} />
    </div>
  );

  function StepList({ title, steps }: { title: string; steps: BackendSetupStatus["steps"] }) {
    if (steps.length === 0) return null;
    return (
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--gray-500)]">{title}</h2>
        <div className="space-y-2">
          {steps.map((s) => (
            <Card key={s.key} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--gray-900)]">{s.title}</p>
                  <Badge variant={s.complete ? "green" : STATUS_VARIANT[s.status] || "gray"}>{s.complete ? "complete" : s.status}</Badge>
                  {!s.required && <Badge variant="gray">optional</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-[var(--gray-500)]">{s.description}</p>
              </div>
              <Link href={s.actionHref}>
                <Button size="sm" variant={s.complete ? "secondary" : "primary"}>{s.actionLabel}</Button>
              </Link>
            </Card>
          ))}
        </div>
      </section>
    );
  }
}
