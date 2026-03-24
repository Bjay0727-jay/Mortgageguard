// Test helpers — mock Cloudflare Worker bindings
import type { Env } from "../env";

// ─── In-memory KV mock ───
export function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; expiry?: number }>();
  return {
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiry && Date.now() > entry.expiry) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, {
        value,
        expiry: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
      });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cpiCursor: "" }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

// ─── In-memory R2 mock ───
export function createMockR2(): R2Bucket {
  const store = new Map<string, { body: ArrayBuffer; metadata?: Record<string, string> }>();
  return {
    put: async (key: string, value: any) => {
      const buf = typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
      store.set(key, { body: buf });
      return { key, size: buf.byteLength } as R2Object;
    },
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        body: new ReadableStream(),
        arrayBuffer: async () => entry.body,
        text: async () => new TextDecoder().decode(entry.body),
        json: async () => JSON.parse(new TextDecoder().decode(entry.body)),
        size: entry.body.byteLength,
      } as unknown as R2ObjectBody;
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    head: async (key: string) => (store.has(key) ? ({ key } as R2Object) : null),
    list: async () => ({
      objects: [...store.keys()].map((key) => ({ key })),
      truncated: false,
    }),
  } as unknown as R2Bucket;
}

// ─── In-memory Queue mock ───
export function createMockQueue<T = unknown>(): Queue<T> & { messages: T[] } {
  const messages: T[] = [];
  return {
    messages,
    send: async (body: T) => {
      messages.push(body);
    },
    sendBatch: async (batch: Iterable<MessageSendRequest<T>>) => {
      for (const msg of batch) messages.push(msg.body);
    },
  } as unknown as Queue<T> & { messages: T[] };
}

// ─── Build mock Env ───
export function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    HYPERDRIVE: {
      connectionString: "postgres://test:test@localhost:5432/test",
    } as unknown as Hyperdrive,
    DOCUMENTS: createMockR2(),
    EXPORTS: createMockR2(),
    RULE_CACHE: createMockKV(),
    SESSIONS: createMockKV(),
    COMPLIANCE_QUEUE: createMockQueue(),
    AUDIT_QUEUE: createMockQueue(),
    ENVIRONMENT: "test",
    APP_NAME: "MortgageGuard-Test",
    JWT_SECRET: "test-secret-key-for-unit-tests-only-32chars!",
    RESEND_API_KEY: "re_test_key",
    ...overrides,
  };
}
