// ─────────────────────────────────────────────────────────────
// MortgageGuard — Event outbox (transactional outbox / audit reliability)
//
// Critical compliance events are durable: instead of relying only on a
// best-effort queue/audit write, the domain action records a row in
// `event_outbox`, which a processor later delivers (audit/queue/notification)
// with retry + backoff + dead-lettering. Pure helpers (backoff, idempotency
// key, redaction) are unit-tested; DB functions take an injected `sql` so they
// are testable with the existing postgres mock.
// ─────────────────────────────────────────────────────────────

export type OutboxStatus = "pending" | "processing" | "processed" | "failed" | "dead_letter";

export interface CreateOutboxEventInput {
  companyId?: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface OutboxEvent {
  id: string;
  company_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  processed_at: string | null;
  dead_lettered_at: string | null;
}

// ── Redaction ──
// Any object key whose lowercased name contains one of these substrings has its
// value replaced with "[REDACTED]" (recursively). Keeps secrets out of the
// durable payload / admin UI.
export const SENSITIVE_KEY_PARTS = ["password", "token", "secret", "apikey", "clientsecret", "authorization", "credential"];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_\-\s]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

export function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactPayload(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? "[REDACTED]" : redactPayload(v);
    }
    return out;
  }
  return value;
}

// Ensure the payload is JSON-safe (no functions, bigints, undefined, circular
// refs) and redacted. Throws on values that cannot be serialized.
export function normalizeOutboxPayload(payload: Record<string, unknown>): Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload ?? {});
  } catch {
    throw new Error("Outbox payload is not JSON-serializable");
  }
  return redactPayload(JSON.parse(serialized)) as Record<string, unknown>;
}

// ── Backoff ──
// Minutes to wait before the next attempt, indexed by attempts-so-far.
// attempt 1 → +1m, 2 → +5m, 3 → +15m, 4 → +60m. Attempt 5 is the cap and is
// dead-lettered by the processor rather than rescheduled.
export const BACKOFF_MINUTES = [1, 5, 15, 60];
export const DEFAULT_MAX_ATTEMPTS = 5;

export function deriveNextAttemptAt(attempts: number, now: Date = new Date()): Date {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1;
  return new Date(now.getTime() + BACKOFF_MINUTES[idx] * 60_000);
}

// ── Idempotency ──
// Deterministic key so a retried domain action doesn't create a duplicate
// outbox row. Falls back to aggregate+event when no explicit key is given.
export function buildOutboxIdempotencyKey(input: CreateOutboxEventInput): string {
  if (input.idempotencyKey) return input.idempotencyKey;
  return `${input.aggregateType}:${input.aggregateId ?? "na"}:${input.eventType}`;
}

// ── DB operations (sql injected for testability) ──

// Create a single outbox event. Idempotent on idempotency_key: if a row with the
// same key exists, the existing row is returned and no duplicate is inserted.
export async function createOutboxEvent(sql: any, input: CreateOutboxEventInput): Promise<OutboxEvent> {
  const idempotencyKey = buildOutboxIdempotencyKey(input);
  const payload = normalizeOutboxPayload(input.payload);
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const [existing] = await sql`SELECT * FROM event_outbox WHERE idempotency_key = ${idempotencyKey}`;
  if (existing) return existing as OutboxEvent;

  const [row] = await sql`
    INSERT INTO event_outbox (company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, max_attempts)
    VALUES (${input.companyId ?? null}, ${input.eventType}, ${input.aggregateType}, ${input.aggregateId ?? null}, ${sql.json(payload)}, ${idempotencyKey}, ${maxAttempts})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *`;
  if (row) return row as OutboxEvent;
  // Lost a race — return the now-existing row.
  const [raced] = await sql`SELECT * FROM event_outbox WHERE idempotency_key = ${idempotencyKey}`;
  return raced as OutboxEvent;
}

export async function createOutboxEvents(sql: any, inputs: CreateOutboxEventInput[]): Promise<OutboxEvent[]> {
  const out: OutboxEvent[] = [];
  for (const input of inputs) out.push(await createOutboxEvent(sql, input));
  return out;
}

// Best-effort create — never throws into the calling domain handler. Returns
// null on failure so an outbox hiccup can't break the primary action.
export async function tryCreateOutboxEvent(sql: any, input: CreateOutboxEventInput): Promise<OutboxEvent | null> {
  try {
    return await createOutboxEvent(sql, input);
  } catch {
    return null;
  }
}

// Atomically claim due pending/failed events by flipping them to `processing`.
export async function claimOutboxEvents(sql: any, options: { limit?: number; now?: Date; eventTypes?: string[] } = {}): Promise<OutboxEvent[]> {
  const limit = options.limit ?? 50;
  const now = (options.now ?? new Date()).toISOString();
  const types = options.eventTypes && options.eventTypes.length ? options.eventTypes : null;
  return (await sql`
    UPDATE event_outbox SET status = 'processing', processing_started_at = NOW(), updated_at = NOW()
    WHERE id IN (
      SELECT id FROM event_outbox
      WHERE status IN ('pending', 'failed') AND next_attempt_at <= ${now}
        AND (${types}::text[] IS NULL OR event_type = ANY(${types}::text[]))
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`) as OutboxEvent[];
}

export async function markOutboxProcessed(sql: any, eventId: string, queueMessageId?: string | null): Promise<void> {
  await sql`UPDATE event_outbox SET status = 'processed', processed_at = NOW(), updated_at = NOW(), attempts = attempts + 1, last_error = NULL, queue_message_id = COALESCE(${queueMessageId ?? null}, queue_message_id) WHERE id = ${eventId}`;
}

// Mark failed and schedule the next attempt; if attempts reach max, dead-letter.
export async function markOutboxFailed(sql: any, event: OutboxEvent, error: string, now: Date = new Date()): Promise<OutboxStatus> {
  const attempts = (event.attempts ?? 0) + 1;
  if (attempts >= (event.max_attempts ?? DEFAULT_MAX_ATTEMPTS)) {
    await sql`UPDATE event_outbox SET status = 'dead_letter', dead_lettered_at = NOW(), updated_at = NOW(), attempts = ${attempts}, last_error = ${error} WHERE id = ${event.id}`;
    return "dead_letter";
  }
  const nextAt = deriveNextAttemptAt(attempts, now).toISOString();
  await sql`UPDATE event_outbox SET status = 'failed', next_attempt_at = ${nextAt}, updated_at = NOW(), attempts = ${attempts}, last_error = ${error} WHERE id = ${event.id}`;
  return "failed";
}

export async function markOutboxDeadLetter(sql: any, eventId: string, error: string): Promise<void> {
  await sql`UPDATE event_outbox SET status = 'dead_letter', dead_lettered_at = NOW(), updated_at = NOW(), last_error = ${error} WHERE id = ${eventId}`;
}

// Reset an event for another attempt (manual retry).
export async function retryOutboxEvent(sql: any, eventId: string, companyScope: string | null): Promise<OutboxEvent | null> {
  const [row] = await sql`
    UPDATE event_outbox SET status = 'pending', next_attempt_at = NOW(), last_error = NULL, dead_lettered_at = NULL, updated_at = NOW()
    WHERE id = ${eventId} AND (${companyScope}::uuid IS NULL OR company_id = ${companyScope})
    RETURNING *`;
  return (row as OutboxEvent) ?? null;
}
