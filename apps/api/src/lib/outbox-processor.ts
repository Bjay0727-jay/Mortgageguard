// ─────────────────────────────────────────────────────────────
// MortgageGuard — Outbox processor
//
// Claims due outbox events, delivers each through its handler, and marks the
// outcome (processed / failed-with-backoff / dead-letter). Driven manually via
// POST /api/v1/outbox/process today; can be wired to a Worker `scheduled`
// handler later without changing this logic.
// ─────────────────────────────────────────────────────────────

import { claimOutboxEvents, markOutboxProcessed, markOutboxFailed, type OutboxEvent } from "./outbox";
import { processOutboxEvent, type OutboxHandlers } from "./outbox-handlers";

export interface OutboxProcessSummary {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
  skipped: number;
}

export interface ProcessOptions {
  limit?: number;
  now?: Date;
  eventTypes?: string[];
}

export async function processPendingOutboxEvents(sql: any, handlers: OutboxHandlers, options: ProcessOptions = {}): Promise<OutboxProcessSummary> {
  const now = options.now ?? new Date();
  const claimed: OutboxEvent[] = await claimOutboxEvents(sql, { limit: options.limit ?? 50, now, eventTypes: options.eventTypes });
  const summary: OutboxProcessSummary = { claimed: claimed.length, processed: 0, failed: 0, deadLettered: 0, skipped: 0 };

  for (const event of claimed) {
    const result = await processOutboxEvent(event, handlers);
    if (result.ok) {
      await markOutboxProcessed(sql, event.id, result.queueMessageId);
      summary.processed++;
    } else {
      const status = await markOutboxFailed(sql, event, result.error || "delivery failed", now);
      if (status === "dead_letter") summary.deadLettered++;
      else summary.failed++;
    }
  }
  return summary;
}
