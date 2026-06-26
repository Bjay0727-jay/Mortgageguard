// ─────────────────────────────────────────────────────────────
// MortgageGuard — Outbox admin helpers (pure, testable)
//
// Status → badge mapping, summary cards, query building, defensive payload
// redaction, and capability-gated action visibility for the admin outbox page.
// ─────────────────────────────────────────────────────────────

import type { BadgeVariant } from "@/components/ui";
import type { Capability } from "@mortgageguard/shared";

export type OutboxStatus = "pending" | "processing" | "processed" | "failed" | "dead_letter";

export interface OutboxSummary {
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  deadLetter: number;
}

export const OUTBOX_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: "blue",
  processing: "amber",
  processed: "green",
  failed: "red",
  dead_letter: "red",
};

export function outboxStatusVariant(status: string | null | undefined): BadgeVariant {
  return OUTBOX_STATUS_VARIANT[status || ""] || "gray";
}

export interface SummaryCard {
  key: keyof OutboxSummary;
  label: string;
  value: number;
  tone: "neutral" | "warn" | "danger" | "good";
}

export function deriveOutboxSummaryCards(summary: OutboxSummary | null | undefined): SummaryCard[] {
  const s = summary ?? { pending: 0, processing: 0, processed: 0, failed: 0, deadLetter: 0 };
  return [
    { key: "pending", label: "Pending", value: s.pending, tone: "neutral" },
    { key: "processing", label: "Processing", value: s.processing, tone: "warn" },
    { key: "failed", label: "Failed", value: s.failed, tone: "danger" },
    { key: "deadLetter", label: "Dead letter", value: s.deadLetter, tone: "danger" },
    { key: "processed", label: "Processed", value: s.processed, tone: "good" },
  ];
}

export interface OutboxFilters {
  status?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function buildOutboxQuery(filters: OutboxFilters): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.eventType) qs.set("eventType", filters.eventType);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.limit) qs.set("limit", String(filters.limit));
  const s = qs.toString();
  return `/api/v1/outbox${s ? `?${s}` : ""}`;
}

// Defensive UI redaction (the API already redacts, but never render a raw secret).
const SENSITIVE_KEY_PARTS = ["password", "token", "secret", "apikey", "clientsecret", "authorization", "credential"];
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\-\s]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}
export function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isSensitiveKey(k) ? "[REDACTED]" : redactPayload(v);
    return out;
  }
  return value;
}

// Capability-gated action visibility for a row.
export function canRetryOutbox(can: (c: Capability) => boolean): boolean {
  return can("retryOutboxEvents");
}
export function canDeadLetterOutbox(can: (c: Capability) => boolean): boolean {
  return can("deadLetterOutboxEvents");
}
export function canProcessOutbox(can: (c: Capability) => boolean): boolean {
  return can("processOutbox");
}
