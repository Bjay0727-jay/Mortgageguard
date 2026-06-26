import { describe, it, expect } from "vitest";
import {
  outboxStatusVariant,
  deriveOutboxSummaryCards,
  buildOutboxQuery,
  redactPayload,
  canRetryOutbox,
  canDeadLetterOutbox,
} from "./outbox";
import type { Capability } from "@mortgageguard/shared";

describe("outboxStatusVariant", () => {
  it("maps statuses to badge variants", () => {
    expect(outboxStatusVariant("pending")).toBe("blue");
    expect(outboxStatusVariant("processed")).toBe("green");
    expect(outboxStatusVariant("failed")).toBe("red");
    expect(outboxStatusVariant("dead_letter")).toBe("red");
    expect(outboxStatusVariant(undefined)).toBe("gray");
  });
});

describe("deriveOutboxSummaryCards", () => {
  it("maps the summary into ordered cards", () => {
    const cards = deriveOutboxSummaryCards({ pending: 3, processing: 1, processed: 10, failed: 2, deadLetter: 1 });
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c.value]));
    expect(byKey.pending).toBe(3);
    expect(byKey.failed).toBe(2);
    expect(byKey.deadLetter).toBe(1);
    expect(byKey.processed).toBe(10);
  });
  it("handles a missing summary", () => {
    expect(deriveOutboxSummaryCards(null).every((c) => c.value === 0)).toBe(true);
  });
});

describe("buildOutboxQuery", () => {
  it("omits unset filters", () => {
    expect(buildOutboxQuery({})).toBe("/api/v1/outbox");
  });
  it("encodes status/eventType/dates/limit", () => {
    expect(buildOutboxQuery({ status: "failed", eventType: "loan.created", limit: 50 }))
      .toBe("/api/v1/outbox?status=failed&eventType=loan.created&limit=50");
  });
});

describe("redactPayload", () => {
  it("redacts sensitive keys recursively", () => {
    const out = redactPayload({ token: "t", nested: { apiKey: "k", ok: 1 } }) as any;
    expect(out.token).toBe("[REDACTED]");
    expect(out.nested.apiKey).toBe("[REDACTED]");
    expect(out.nested.ok).toBe(1);
  });
});

describe("action visibility by capability", () => {
  const grant = (caps: Capability[]) => (c: Capability) => caps.includes(c);
  it("gates retry + dead-letter on capabilities", () => {
    expect(canRetryOutbox(grant(["retryOutboxEvents"]))).toBe(true);
    expect(canRetryOutbox(grant([]))).toBe(false);
    expect(canDeadLetterOutbox(grant(["deadLetterOutboxEvents"]))).toBe(true);
    expect(canDeadLetterOutbox(grant(["retryOutboxEvents"]))).toBe(false);
  });
});
