import { describe, it, expect } from "vitest";
import {
  deriveNextAttemptAt,
  buildOutboxIdempotencyKey,
  redactPayload,
  normalizeOutboxPayload,
  createOutboxEvent,
  markOutboxFailed,
  BACKOFF_MINUTES,
  type OutboxEvent,
} from "./outbox";
import { processPendingOutboxEvents } from "./outbox-processor";
import { buildDefaultHandlers, type OutboxHandlers } from "./outbox-handlers";

describe("deriveNextAttemptAt (backoff)", () => {
  const now = new Date("2026-06-26T00:00:00.000Z");
  it("schedules +1m / +5m / +15m / +60m by attempt", () => {
    expect(deriveNextAttemptAt(1, now).toISOString()).toBe("2026-06-26T00:01:00.000Z");
    expect(deriveNextAttemptAt(2, now).toISOString()).toBe("2026-06-26T00:05:00.000Z");
    expect(deriveNextAttemptAt(3, now).toISOString()).toBe("2026-06-26T00:15:00.000Z");
    expect(deriveNextAttemptAt(4, now).toISOString()).toBe("2026-06-26T01:00:00.000Z");
  });
  it("caps at the last backoff bucket", () => {
    expect(deriveNextAttemptAt(9, now).getTime() - now.getTime()).toBe(BACKOFF_MINUTES[3] * 60_000);
  });
});

describe("buildOutboxIdempotencyKey", () => {
  it("uses an explicit key when provided", () => {
    expect(buildOutboxIdempotencyKey({ eventType: "loan.created", aggregateType: "loan", payload: {}, idempotencyKey: "loan:1:created" })).toBe("loan:1:created");
  });
  it("falls back to aggregate + event", () => {
    expect(buildOutboxIdempotencyKey({ eventType: "loan.created", aggregateType: "loan", aggregateId: "L1", payload: {} })).toBe("loan:L1:loan.created");
  });
});

describe("redactPayload / normalizeOutboxPayload", () => {
  it("redacts sensitive keys recursively", () => {
    const out = redactPayload({ name: "Sam", password: "p", nested: { apiKey: "k", clientSecret: "s", ok: 1 }, list: [{ token: "t" }] }) as any;
    expect(out.name).toBe("Sam");
    expect(out.password).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.clientSecret).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].token).toBe("[REDACTED]");
  });
  it("normalizes + redacts, dropping undefined/functions via JSON", () => {
    const out = normalizeOutboxPayload({ a: 1, authorization: "Bearer x", b: undefined as any });
    expect(out).toEqual({ a: 1, authorization: "[REDACTED]" });
  });
});

// ── DB-backed helpers via an in-memory sql mock ──
function makeSql() {
  const rows: any[] = [];
  const fn = async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM event_outbox WHERE idempotency_key")) {
      return rows.filter((r) => r.idempotency_key === values[0]);
    }
    if (q.startsWith("INSERT INTO event_outbox")) {
      const [company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, max_attempts] = values;
      const row: any = { id: `o${rows.length + 1}`, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, max_attempts, status: "pending", attempts: 0, next_attempt_at: "2026-01-01T00:00:00Z" };
      rows.push(row);
      return [row];
    }
    if (q.startsWith("UPDATE event_outbox SET status = 'processing'")) {
      // claim: return all pending/failed (mock ignores time/locks)
      const claimed = rows.filter((r) => ["pending", "failed"].includes(r.status));
      claimed.forEach((r) => (r.status = "processing"));
      return claimed;
    }
    if (q.startsWith("UPDATE event_outbox SET status = 'processed'")) {
      const r = rows.find((x) => x.id === values[values.length - 1]);
      if (r) { r.status = "processed"; r.attempts++; }
      return [];
    }
    if (q.startsWith("UPDATE event_outbox SET status = 'dead_letter'")) {
      const r = rows.find((x) => x.id === values[values.length - 1]);
      if (r) r.status = "dead_letter";
      return [];
    }
    if (q.startsWith("UPDATE event_outbox SET status = 'failed'")) {
      const r = rows.find((x) => x.id === values[values.length - 1]);
      if (r) { r.status = "failed"; r.attempts = values[1]; }
      return [];
    }
    return [];
  };
  (fn as any).json = (x: any) => x;
  (fn as any).rows = rows;
  return fn;
}

describe("createOutboxEvent (idempotent)", () => {
  it("creates a row and preserves company id", async () => {
    const sql = makeSql();
    const ev = await createOutboxEvent(sql, { companyId: "c1", eventType: "loan.created", aggregateType: "loan", aggregateId: "L1", payload: { x: 1 } });
    expect(ev.company_id).toBe("c1");
    expect(ev.idempotency_key).toBe("loan:L1:loan.created");
    expect((sql as any).rows).toHaveLength(1);
  });
  it("does not duplicate on the same idempotency key", async () => {
    const sql = makeSql();
    const input = { companyId: "c1", eventType: "loan.created", aggregateType: "loan", aggregateId: "L1", payload: {} };
    await createOutboxEvent(sql, input);
    await createOutboxEvent(sql, input);
    expect((sql as any).rows).toHaveLength(1);
  });
});

describe("markOutboxFailed", () => {
  const base: OutboxEvent = { id: "o1", company_id: "c1", event_type: "x", aggregate_type: "a", aggregate_id: null, payload: {}, status: "processing", attempts: 0, max_attempts: 5, next_attempt_at: "", last_error: null, idempotency_key: "k", created_at: "", processed_at: null, dead_lettered_at: null };
  it("reschedules before max attempts", async () => {
    const sql = makeSql();
    (sql as any).rows.push({ ...base });
    const status = await markOutboxFailed(sql, { ...base, attempts: 1 }, "boom");
    expect(status).toBe("failed");
  });
  it("dead-letters at max attempts", async () => {
    const sql = makeSql();
    (sql as any).rows.push({ ...base });
    const status = await markOutboxFailed(sql, { ...base, attempts: 4 }, "boom");
    expect(status).toBe("dead_letter");
  });
});

describe("processPendingOutboxEvents", () => {
  function handlers(failIds: string[] = []): OutboxHandlers {
    const base = buildDefaultHandlers({});
    const failing = async (event: OutboxEvent) => (failIds.includes(event.id) ? { ok: false, error: "fail" } : { ok: true, queueMessageId: null });
    return { ...base, audit: failing, queue: failing };
  }

  it("claims and processes pending events, returning a summary", async () => {
    const sql = makeSql();
    await createOutboxEvent(sql, { eventType: "a.b", aggregateType: "a", aggregateId: "1", payload: {} });
    await createOutboxEvent(sql, { eventType: "a.c", aggregateType: "a", aggregateId: "2", payload: {} });
    const summary = await processPendingOutboxEvents(sql, handlers());
    expect(summary.claimed).toBe(2);
    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it("handles a mixed success/failure batch and reschedules failures", async () => {
    const sql = makeSql();
    await createOutboxEvent(sql, { eventType: "a.b", aggregateType: "a", aggregateId: "1", payload: {} });
    await createOutboxEvent(sql, { eventType: "a.c", aggregateType: "a", aggregateId: "2", payload: {} });
    const summary = await processPendingOutboxEvents(sql, handlers(["o2"]));
    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(1);
  });
});
