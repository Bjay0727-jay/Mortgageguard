"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";

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

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-gray-500">Loading dashboard...</p>;
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {user?.name}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Avg Compliance Score"
          value={`${data.examReadiness.avgScore}%`}
          color={data.examReadiness.avgScore >= 80 ? "green" : data.examReadiness.avgScore >= 50 ? "amber" : "red"}
        />
        <KpiCard
          label="Total Loans"
          value={String(data.examReadiness.totalLoans)}
        />
        <KpiCard
          label="Passing (80%+)"
          value={String(data.examReadiness.passingLoans)}
          color="green"
        />
        <KpiCard
          label="Critical Alerts"
          value={String(data.examReadiness.criticalAlerts)}
          color={data.examReadiness.criticalAlerts > 0 ? "red" : "green"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Attention Required */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Loans Needing Attention
          </h2>
          {data.attentionLoans.length === 0 ? (
            <p className="text-sm text-gray-500">All loans are compliant!</p>
          ) : (
            <div className="space-y-3">
              {data.attentionLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {loan.loan_number}
                    </p>
                    <p className="text-xs text-gray-500">
                      {loan.borrower} &middot; {loan.property_state}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={loan.status} />
                    <ScoreBadge score={loan.compliance_score} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Upcoming Deadlines
          </h2>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming deadlines.</p>
          ) : (
            <div className="space-y-3">
              {data.upcomingDeadlines.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {d.report_type}
                    </p>
                    <p className="text-xs text-gray-500">
                      Due: {d.due_date}
                    </p>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline + Volume */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Pipeline
          </h2>
          <div className="space-y-2">
            {data.pipeline.map((p) => (
              <div key={p.status} className="flex items-center justify-between">
                <StatusBadge status={p.status} />
                <span className="text-sm font-semibold text-gray-900">
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Programs Status
          </h2>
          <div className="space-y-2">
            {data.programs.map((p) => (
              <div key={p.status} className="flex items-center justify-between">
                <span className="text-sm capitalize text-gray-700">{p.status}</span>
                <span className="text-sm font-semibold text-gray-900">
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "amber" | "red";
}) {
  const valueColor =
    color === "green"
      ? "text-green-700"
      : color === "amber"
        ? "text-amber-700"
        : color === "red"
          ? "text-red-700"
          : "text-gray-900";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}
