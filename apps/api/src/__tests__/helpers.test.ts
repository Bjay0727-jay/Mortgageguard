import { describe, it, expect } from "vitest";
import { createMockKV, createMockR2, createMockQueue, createMockEnv } from "./helpers";

describe("Mock KV Namespace", () => {
  it("stores and retrieves values", async () => {
    const kv = createMockKV();
    await kv.put("key1", "value1");
    expect(await kv.get("key1")).toBe("value1");
  });

  it("returns null for missing keys", async () => {
    const kv = createMockKV();
    expect(await kv.get("nonexistent")).toBeNull();
  });

  it("deletes keys", async () => {
    const kv = createMockKV();
    await kv.put("key1", "value1");
    await kv.delete("key1");
    expect(await kv.get("key1")).toBeNull();
  });
});

describe("Mock R2 Bucket", () => {
  it("stores and retrieves objects", async () => {
    const r2 = createMockR2();
    await r2.put("doc.pdf", "file content");
    const obj = await r2.get("doc.pdf");
    expect(obj).not.toBeNull();
    const text = await obj!.text();
    expect(text).toBe("file content");
  });

  it("returns null for missing objects", async () => {
    const r2 = createMockR2();
    expect(await r2.get("missing")).toBeNull();
  });

  it("deletes objects", async () => {
    const r2 = createMockR2();
    await r2.put("doc.pdf", "content");
    await r2.delete("doc.pdf");
    expect(await r2.get("doc.pdf")).toBeNull();
  });
});

describe("Mock Queue", () => {
  it("captures sent messages", async () => {
    const queue = createMockQueue<{ type: string }>();
    await queue.send({ type: "test" });
    await queue.send({ type: "test2" });
    expect(queue.messages).toHaveLength(2);
    expect(queue.messages[0]).toEqual({ type: "test" });
  });
});

describe("createMockEnv", () => {
  it("creates a valid mock environment", () => {
    const env = createMockEnv();
    expect(env.ENVIRONMENT).toBe("test");
    expect(env.APP_NAME).toBe("MortgageGuard-Test");
    expect(env.JWT_SECRET).toBeTruthy();
    expect(env.HYPERDRIVE).toBeDefined();
    expect(env.DOCUMENTS).toBeDefined();
    expect(env.RULE_CACHE).toBeDefined();
    expect(env.SESSIONS).toBeDefined();
  });

  it("allows overriding values", () => {
    const env = createMockEnv({ ENVIRONMENT: "staging" });
    expect(env.ENVIRONMENT).toBe("staging");
  });
});
