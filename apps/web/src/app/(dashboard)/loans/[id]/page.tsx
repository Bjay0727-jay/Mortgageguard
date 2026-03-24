"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";

interface Loan {
  id: string;
  loan_number: string;
  borrower_first_name: string;
  borrower_last_name: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  status: string;
  loan_purpose: string;
  loan_product: string;
  loan_type: string;
  loan_amount: string;
  interest_rate: string;
  loan_term: number;
  lien_position: string;
  occupancy_type: string;
  compliance_score: number;
  docs_complete: number;
  docs_required: number;
  originator_name: string;
  application_date: string;
  closing_date: string | null;
}

interface ChecklistItem {
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  weight: number;
  pipelineStage: string | null;
  source: string;
  uploaded: boolean;
  uploadStatus: string | null;
  isSigned: boolean;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  stage_from: string | null;
  stage_to: string | null;
  description: string;
  occurred_at: string;
  performed_by_name: string | null;
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tab, setTab] = useState<"details" | "checklist" | "timeline">("details");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ loan: Loan }>(`/api/v1/loans/${id}`).then((d) => setLoan(d.loan)).catch((e) => setError(e.message));
    api.get<{ checklist: ChecklistItem[] }>(`/api/v1/loans/${id}/checklist`).then((d) => setChecklist(d.checklist));
    api.get<{ events: TimelineEvent[] }>(`/api/v1/loans/${id}/timeline`).then((d) => setTimeline(d.events));
  }, [id]);

  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!loan) return <p className="text-gray-500">Loading...</p>;

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  const tabs = [
    { key: "details", label: "Loan Details" },
    { key: "checklist", label: `Checklist (${checklist.filter((c) => c.uploaded).length}/${checklist.length})` },
    { key: "timeline", label: "Timeline" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/loans" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Loans
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{loan.loan_number}</h1>
        <StatusBadge status={loan.status} />
        <ScoreBadge score={loan.compliance_score} />
      </div>

      {/* Borrower + Property summary */}
      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-500">Borrower</p>
          <p className="text-sm font-medium text-gray-900">
            {loan.borrower_last_name}, {loan.borrower_first_name}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Property</p>
          <p className="text-sm font-medium text-gray-900">
            {loan.property_address}, {loan.property_city}, {loan.property_state} {loan.property_zip}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Amount</p>
          <p className="text-sm font-medium text-gray-900">{loan.loan_amount ? fmt(loan.loan_amount) : "—"}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                tab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "details" && (
        <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-3">
          {[
            ["Purpose", loan.loan_purpose],
            ["Product", loan.loan_product],
            ["Type", loan.loan_type],
            ["Rate", loan.interest_rate ? `${loan.interest_rate}%` : "—"],
            ["Term", loan.loan_term ? `${loan.loan_term} mo` : "—"],
            ["Lien", loan.lien_position],
            ["Occupancy", loan.occupancy_type],
            ["Application", loan.application_date],
            ["Closing", loan.closing_date || "—"],
            ["Originator", loan.originator_name || "—"],
            ["Docs", `${loan.docs_complete}/${loan.docs_required}`],
            ["Score", `${loan.compliance_score}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm font-medium capitalize text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "checklist" && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Document</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checklist.map((item) => (
                <tr key={item.documentType} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{item.displayName}</p>
                    {item.isMandatory && <span className="text-xs text-red-600">Required</span>}
                  </td>
                  <td className="px-4 py-3 text-sm capitalize text-gray-600">{item.source}</td>
                  <td className="px-4 py-3 text-sm capitalize text-gray-600">{item.pipelineStage || "—"}</td>
                  <td className="px-4 py-3">
                    {item.uploaded ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                        {item.isSigned ? "Signed" : "Uploaded"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                        Missing
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-3">
          {timeline.map((event) => (
            <div key={event.id} className="flex gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{event.description || event.event_type}</p>
                <p className="text-xs text-gray-500">
                  {new Date(event.occurred_at).toLocaleString()}
                  {event.performed_by_name && ` by ${event.performed_by_name}`}
                </p>
              </div>
              {event.stage_to && <StatusBadge status={event.stage_to} />}
            </div>
          ))}
          {timeline.length === 0 && (
            <p className="text-sm text-gray-500">No events yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
