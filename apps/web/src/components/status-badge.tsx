"use client";

const STAGE_COLORS: Record<string, string> = {
  application: "bg-blue-100 text-blue-800",
  processing: "bg-indigo-100 text-indigo-800",
  underwriting: "bg-purple-100 text-purple-800",
  closing: "bg-amber-100 text-amber-800",
  post_close: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
  withdrawn: "bg-gray-100 text-gray-800",
};

const STAGE_LABELS: Record<string, string> = {
  application: "Application",
  processing: "Processing",
  underwriting: "Underwriting",
  closing: "Closing",
  post_close: "Post-Close",
  denied: "Denied",
  withdrawn: "Withdrawn",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STAGE_COLORS[status] || "bg-gray-100 text-gray-800";
  const label = STAGE_LABELS[status] || status;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}
