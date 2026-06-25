"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import {
  PIPELINE_STAGES,
  REQUIRED_PROGRAM_SETUP,
  buildSetupChecklist,
  getSetupProgress,
  isDefaultAdmin,
  type SetupChecklistItem,
} from "@/lib/dashboard-setup";

interface DashboardData {
  examReadiness: {
    avgScore: number;
    totalLoans: number;
    criticalAlerts: number;
    passingLoans: number;
    totalVolume: number;
  };
  pipeline: { status: string; count: number }[];
  upcomingDeadlines: { id: string; report_type: string; due_date: string; status: string }[];
  attentionLoans: {
    id: string;
    loan_number: string;
    borrower: string;
    property_state: string;
    status: string;
    compliance_score: number;
  }[];
  programs: { status: string; count: number }[];
}

const T = {
  royal: "#1B3A6B",
  royalLt: "#2B5298",
  royalPl: "#E8EEF7",
  grn: "#0F7B46",
  grnLt: "#15A35E",
  grnPl: "#E6F5EE",
  red: "#C4302B",
  redPl: "#FEF0EF",
  amb: "#B8860B",
  ambPl: "#FFF8E7",
  shadowSm: "0 1px 3px rgba(27,58,107,.06)",
  shadowMd: "0 10px 30px rgba(27,58,107,.12)",
};

function scoreColor(score: number) {
  if (score >= 80) return T.grn;
  if (score >= 50) return T.amb;
  return T.red;
}

function scoreBg(score: number) {
  if (score >= 80) return T.grnPl;
  if (score >= 50) return T.ambPl;
  return T.redPl;
}

function titleCase(stage: string) {
  return stage.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<DashboardData>("/api/v1/compliance/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const setupItems = useMemo(() => {
    if (!data) return [];
    return buildSetupChecklist({
      totalLoans: data.examReadiness.totalLoans,
      upcomingDeadlinesCount: data.upcomingDeadlines.length,
      programs: data.programs,
      user,
    });
  }, [data, user]);
  const setupProgress = getSetupProgress(setupItems);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Loading dashboard...
      </div>
    );
  }

  const pipelineCounts = new Map(data.pipeline.map((stage) => [stage.status, stage.count]));
  const hasNoLoans = data.examReadiness.totalLoans === 0;
  const noDeadlines = data.upcomingDeadlines.length === 0;
  const shouldShowOnboarding = setupProgress.complete < setupProgress.total;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <div className="bg-gradient-to-r from-[#1B3A6B] via-[#2B5298] to-[#0F7B46] px-6 py-6 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Compliance command center</p>
              <h1 className="mt-2 text-3xl font-bold">Welcome back, {user?.name || "Administrator"}</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/75">
                MortgageGuard guides your team from first setup to exam-ready reporting with checklists, deadlines, programs, and audit trails.
              </p>
            </div>
            <Link href="/loans" className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#1B3A6B] shadow-sm hover:bg-[#E8EEF7]">
              Create First Loan
            </Link>
          </div>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_360px]">
          <SetupProgressCard complete={setupProgress.complete} total={setupProgress.total} percent={setupProgress.percent} />
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-900">Today&apos;s focus</p>
            <p className="mt-1 text-sm text-green-800">
              {setupProgress.percent < 100
                ? "Finish setup so checklist generation and reporting feel complete from day one."
                : "Your setup is ready. Continue monitoring loan and program compliance."}
            </p>
          </div>
        </div>
      </section>

      {(isDefaultAdmin(user) || shouldShowOnboarding) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {isDefaultAdmin(user) && (
            <WarningCard
              title="Default admin account detected"
              description="Change this password before using production data."
              href="/change-password"
              cta="Change Password"
            />
          )}
          <WarningCard
            title="Texas compliance rules are not loaded yet"
            description="Load or verify Texas rules so checklists, scores, and reporting deadlines can be generated accurately."
            href="/settings/company?tab=rules"
            cta="View Setup Instructions"
          />
        </div>
      )}

      {shouldShowOnboarding && <OnboardingPanel items={setupItems} />}

      <RecommendedActions
        actions={[
          { title: "Create first loan", description: "Start a file and generate its initial compliance checklist.", href: "/loans", cta: "Create Loan", priority: "High" },
          { title: "Add required programs", description: "Upload AML, Red Flags, InfoSec, compensation, and remote work policies.", href: "/programs", cta: "Set Up Programs", priority: "High" },
          { title: "Configure reporting deadlines", description: "Track quarterly and state-specific filing due dates.", href: "/reports", cta: "Configure Deadlines", priority: "Medium" },
          { title: "Invite users", description: "Bring in processors, originators, compliance officers, and reviewers.", href: "/settings/users", cta: "Invite Team", priority: "Medium" },
          { title: "Connect LOS", description: "Sync loan data and documents from your origination system.", href: "/integrations", cta: "Connect", priority: "Low" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard href="/dashboard" label="Exam Readiness" value={`${data.examReadiness.avgScore}%`} color={scoreColor(data.examReadiness.avgScore)} bgColor={scoreBg(data.examReadiness.avgScore)} icon="✓" />
        <MetricCard href="/loans" label="Total Loans" value={String(data.examReadiness.totalLoans)} color={T.royal} bgColor={T.royalPl} icon="◫" />
        <MetricCard href="/loans?score=critical" label="Critical Alerts" value={String(data.examReadiness.criticalAlerts)} color={data.examReadiness.criticalAlerts > 0 ? T.red : T.grn} bgColor={data.examReadiness.criticalAlerts > 0 ? T.redPl : T.grnPl} icon="!" />
        <MetricCard href="/loans?score=passing" label="Passing Loans" value={String(data.examReadiness.passingLoans)} color={T.grn} bgColor={T.grnPl} icon="盾" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Loans Needing Attention">
          {data.attentionLoans.length === 0 ? (
            hasNoLoans ? (
              <ActionEmptyState icon="🏠" title="No loans yet. Create your first loan to generate a compliance checklist." href="/loans" cta="Create First Loan" />
            ) : (
              <p className="text-sm text-gray-500">All loans are compliant!</p>
            )
          ) : (
            <div className="space-y-3">
              {data.attentionLoans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ScoreRing score={loan.compliance_score} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{loan.loan_number}</p>
                      <p className="text-xs text-gray-500">{loan.borrower} · {loan.property_state}</p>
                    </div>
                  </div>
                  <StatusBadge status={loan.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Upcoming Deadlines">
          {noDeadlines ? (
            <ActionEmptyState icon="📅" title="No reporting deadlines configured." href="/reports" cta="Configure Deadlines" />
          ) : (
            <div className="space-y-3">
              {data.upcomingDeadlines.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{d.report_type}</p>
                    <p className="text-xs text-gray-500">Due: {d.due_date}</p>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Pipeline">
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage) => {
              const count = pipelineCounts.get(stage) || 0;
              const width = data.examReadiness.totalLoans > 0 ? Math.max((count / data.examReadiness.totalLoans) * 100, 4) : 4;
              return (
                <div key={stage}>
                  <div className="mb-1 flex items-center justify-between">
                    <StatusBadge status={stage} />
                    <span className="text-sm font-semibold text-gray-900">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-[#1B3A6B]" style={{ width: `${width}%`, opacity: count ? 1 : 0.25 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Programs Status">
          <div className="space-y-3">
            {REQUIRED_PROGRAM_SETUP.map((program) => (
              <div key={program} className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{program}</p>
                    <p className="text-xs text-red-700">Missing</p>
                  </div>
                </div>
                <Link href="/programs" className="text-xs font-semibold text-[#1B3A6B] hover:underline">Set Up</Link>
              </div>
            ))}
            <Link href="/programs" className="inline-flex rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298]">Set Up Programs</Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SetupProgressCard({ complete, total, percent }: { complete: number; total: number; percent: number }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-[#E8EEF7] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[#1B3A6B]">Compliance Setup Progress</p>
          <p className="mt-1 text-sm text-gray-600">{complete} of {total} setup steps complete.</p>
        </div>
        <span className="text-2xl font-bold text-[#1B3A6B]">{percent}%</span>
      </div>
      <div className="mt-4 h-3 rounded-full bg-white">
        <div className="h-3 rounded-full bg-[#0F7B46] transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function OnboardingPanel({ items }: { items: SetupChecklistItem[] }) {
  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#1B3A6B]">Get MortgageGuard ready</h2>
          <p className="mt-1 text-sm text-gray-500">Complete these setup steps to start generating compliance checklists and exam-readiness reports.</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className={`rounded-xl border p-4 ${item.complete ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8EEF7] text-lg">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.complete ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{item.complete ? "Complete" : "Incomplete"}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-500">{item.explanation}</p>
                <Link href={item.href} className="mt-3 inline-flex rounded-lg border border-[#1B3A6B] px-3 py-1.5 text-xs font-semibold text-[#1B3A6B] hover:bg-[#E8EEF7]">{item.cta}</Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecommendedActions({ actions }: { actions: { title: string; description: string; href: string; cta: string; priority: "High" | "Medium" | "Low" }[] }) {
  return (
    <section className="rounded-2xl border border-green-100 bg-green-50 p-5">
      <h2 className="text-lg font-bold text-green-950">Recommended Next Actions</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {actions.map((action) => (
          <div key={action.title} className="rounded-xl bg-white p-4 shadow-sm">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${action.priority === "High" ? "bg-red-100 text-red-700" : action.priority === "Medium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{action.priority}</span>
            <h3 className="mt-3 text-sm font-semibold text-gray-900">{action.title}</h3>
            <p className="mt-1 min-h-[48px] text-xs leading-5 text-gray-500">{action.description}</p>
            <Link href={action.href} className="mt-3 inline-flex text-xs font-semibold text-[#1B3A6B] hover:underline">{action.cta} →</Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function WarningCard({ title, description, href, cta }: { title: string; description: string; href: string; cta: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-amber-950">{title}</p>
          <p className="mt-1 text-sm text-amber-800">{description}</p>
          <Link href={href} className="mt-3 inline-flex rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">{cta}</Link>
        </div>
      </div>
    </div>
  );
}

function ActionEmptyState({ icon, title, href, cta }: { icon: string; title: string; href: string; cta: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mx-auto mt-3 max-w-sm text-sm text-gray-600">{title}</p>
      <Link href={href} className="mt-4 inline-flex rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298]">{cta}</Link>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#1B3A6B]">{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value, color, bgColor, icon, href }: { label: string; value: string; color: string; bgColor: string; icon: string; href: string }) {
  return (
    <Link href={href} aria-label={`${label}: ${value}`} className="group block rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold" style={{ backgroundColor: bgColor, color }}>{icon}</div>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="mt-2 text-xs text-gray-400 group-hover:text-gray-600">Open details →</p>
    </Link>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = scoreColor(score);
  const bg = scoreBg(score);
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 40, height: 40 }}>
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="16" fill={bg} stroke="#e5e7eb" strokeWidth="3" />
        <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 20 20)" />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  );
}
