"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

/* ── Design tokens ── */
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
  shadowMd: "0 4px 12px rgba(27,58,107,.1)",
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
      <div
        className="text-sm"
        style={{
          backgroundColor: T.redPl,
          color: T.red,
          borderRadius: 10,
          padding: 16,
        }}
      >
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1
          className="text-2xl font-bold"
          style={{ color: T.royal }}
        >
          Dashboard
        </h1>
        <p className="text-sm text-gray-500">
          Welcome back, {user?.name}
        </p>
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Exam Readiness"
          value={`${data.examReadiness.avgScore}%`}
          color={scoreColor(data.examReadiness.avgScore)}
          bgColor={scoreBg(data.examReadiness.avgScore)}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />
        <MetricCard
          label="Total Loans"
          value={String(data.examReadiness.totalLoans)}
          color={T.royal}
          bgColor={T.royalPl}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          }
        />
        <MetricCard
          label="Critical Alerts"
          value={String(data.examReadiness.criticalAlerts)}
          color={data.examReadiness.criticalAlerts > 0 ? T.red : T.grn}
          bgColor={data.examReadiness.criticalAlerts > 0 ? T.redPl : T.grnPl}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
        />
        <MetricCard
          label="Passing Loans"
          value={String(data.examReadiness.passingLoans)}
          color={T.grn}
          bgColor={T.grnPl}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          }
        />
      </div>

      {/* ── Two-column detail panels ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Loans Needing Attention */}
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            boxShadow: T.shadowSm,
            padding: 20,
          }}
        >
          <h2
            className="mb-4 text-sm font-semibold"
            style={{ color: T.royal }}
          >
            Loans Needing Attention
          </h2>
          {data.attentionLoans.length === 0 ? (
            <p className="text-sm text-gray-500">All loans are compliant!</p>
          ) : (
            <div className="space-y-3">
              {data.attentionLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="flex items-center justify-between"
                  style={{
                    backgroundColor: "#f9fafb",
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <ScoreRing score={loan.compliance_score} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {loan.loan_number}
                      </p>
                      <p className="text-xs text-gray-500">
                        {loan.borrower} &middot; {loan.property_state}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={loan.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            boxShadow: T.shadowSm,
            padding: 20,
          }}
        >
          <h2
            className="mb-4 text-sm font-semibold"
            style={{ color: T.royal }}
          >
            Upcoming Deadlines
          </h2>
          {data.upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming deadlines.</p>
          ) : (
            <div className="space-y-3">
              {data.upcomingDeadlines.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between"
                  style={{
                    backgroundColor: "#f9fafb",
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}
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

      {/* ── Pipeline + Programs ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            boxShadow: T.shadowSm,
            padding: 20,
          }}
        >
          <h2
            className="mb-4 text-sm font-semibold"
            style={{ color: T.royal }}
          >
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

        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            boxShadow: T.shadowSm,
            padding: 20,
          }}
        >
          <h2
            className="mb-4 text-sm font-semibold"
            style={{ color: T.royal }}
          >
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

/* ── Metric Card ── */
function MetricCard({
  label,
  value,
  color,
  bgColor,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="group"
      style={{
        backgroundColor: "#fff",
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        boxShadow: T.shadowSm,
        padding: 20,
        transition: "box-shadow .2s, transform .2s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = T.shadowMd;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = T.shadowSm;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <p
          className="font-semibold"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#6b7280",
          }}
        >
          {label}
        </p>
        <div
          className="flex items-center justify-center"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: bgColor,
            color: color,
          }}
        >
          {icon}
        </div>
      </div>
      <p
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: color,
          lineHeight: 1.2,
        }}
      >
        {value}
      </p>
    </div>
  );
}

/* ── Score Ring ── */
function ScoreRing({ score }: { score: number }) {
  const color = scoreColor(score);
  const bg = scoreBg(score);
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 40, height: 40 }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill={bg}
          stroke="#e5e7eb"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span
        className="absolute text-xs font-bold"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}
