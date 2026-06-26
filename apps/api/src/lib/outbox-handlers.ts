// ─────────────────────────────────────────────────────────────
// MortgageGuard — Outbox event handlers
//
// Delivery side of the outbox. Each event is dispatched to a handler by type;
// for the MVP every event is delivered to the existing audit queue (durable
// source → at-least-once delivery). notification/webhook are placeholders that
// later prompts (e.g. Notification Center) can implement.
// ─────────────────────────────────────────────────────────────

import type { OutboxEvent } from "./outbox";

export type OutboxHandlerType = "audit" | "queue" | "notification" | "webhook" | "noop";

export interface ProcessResult {
  ok: boolean;
  error?: string;
  queueMessageId?: string | null;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<ProcessResult>;
export type OutboxHandlers = Record<OutboxHandlerType, OutboxHandler>;

// Decide which handler delivers an event. Notification/webhook events are routed
// by prefix; everything else becomes a durable audit record.
export function handlerTypeForEvent(event: OutboxEvent): OutboxHandlerType {
  const t = event.event_type;
  if (t.startsWith("notification.")) return "notification";
  if (t.startsWith("webhook.")) return "webhook";
  return "audit";
}

// Build the default handler set bound to the worker env. Missing bindings (local
// tests) degrade to no-op success so processing never hard-fails on absence.
export function buildDefaultHandlers(env: { AUDIT_QUEUE?: { send: (m: any) => Promise<void> } }): OutboxHandlers {
  const audit: OutboxHandler = async (event) => {
    if (!env.AUDIT_QUEUE) return { ok: true, queueMessageId: null };
    await env.AUDIT_QUEUE.send({
      type: event.event_type,
      entityType: event.aggregate_type,
      entityId: event.aggregate_id,
      companyId: event.company_id,
      outboxId: event.id,
      timestamp: new Date().toISOString(),
      details: event.payload,
    });
    return { ok: true, queueMessageId: event.id };
  };
  const noop: OutboxHandler = async () => ({ ok: true, queueMessageId: null });
  return { audit, queue: audit, notification: noop, webhook: noop, noop };
}

// Process a single event through its handler. Never throws — failures are
// returned as ProcessResult so the processor can schedule a retry.
export async function processOutboxEvent(event: OutboxEvent, handlers: OutboxHandlers): Promise<ProcessResult> {
  const type = handlerTypeForEvent(event);
  const handler = handlers[type] ?? handlers.noop;
  try {
    return await handler(event);
  } catch (e: any) {
    return { ok: false, error: e?.message || "handler error" };
  }
}
