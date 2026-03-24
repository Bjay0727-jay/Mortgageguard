"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";

interface Loan {
  id: string;
  loan_number: string;
  borrower_first_name: string;
  borrower_last_name: string;
  property_state: string;
  property_city: string;
  status: string;
  loan_purpose: string;
  loan_product: string;
  loan_amount: string;
  compliance_score: number;
  docs_complete: number;
  docs_required: number;
  originator_name: string;
  created_at: string;
}

interface LoansResponse {
  loans: Loan[];
  pagination: { total: number; limit: number; offset: number };
}

export default function LoansPage() {
  const [data, setData] = useState<LoansResponse | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [error, setError] = useState("");

  function loadLoans() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (stateFilter) params.set("state", stateFilter);
    const qs = params.toString();
    api
      .get<LoansResponse>(`/api/v1/loans${qs ? `?${qs}` : ""}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadLoans();
  }, [statusFilter, stateFilter]);

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(n));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Loans</h1>
        <span className="text-sm text-gray-500">
          {data ? `${data.pagination.total} total` : ""}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadLoans();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            placeholder="Search loans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B5298]"
          >
            Search
          </button>
        </form>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Stages</option>
          <option value="application">Application</option>
          <option value="processing">Processing</option>
          <option value="underwriting">Underwriting</option>
          <option value="closing">Closing</option>
          <option value="post_close">Post-Close</option>
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All States</option>
          <option value="TX">Texas</option>
          <option value="CA">California</option>
          <option value="FL">Florida</option>
          <option value="NY">New York</option>
        </select>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loan Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Loan #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Borrower
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Stage
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Docs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.loans.map((loan) => (
              <tr key={loan.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/loans/${loan.id}`}
                    className="text-sm font-medium text-blue-700 hover:underline"
                  >
                    {loan.loan_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {loan.borrower_last_name}, {loan.borrower_first_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {loan.property_state}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {loan.loan_amount ? fmt(loan.loan_amount) : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={loan.status} />
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={loan.compliance_score} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {loan.docs_complete}/{loan.docs_required}
                </td>
              </tr>
            ))}
            {data?.loans.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No loans found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
