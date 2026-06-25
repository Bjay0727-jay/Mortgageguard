import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, encryptOptional } from "./secrets";
import { simulateConnectionTest } from "./integrations";

const MASTER = "test-secret-key-for-unit-tests-only-32chars!";

describe("secret encryption at rest", () => {
  it("round-trips a secret", async () => {
    const enc = await encryptSecret("super-secret-client-secret", MASTER);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("super-secret");
    expect(await decryptSecret(enc, MASTER)).toBe("super-secret-client-secret");
  });

  it("fails to decrypt with the wrong master secret", async () => {
    const enc = await encryptSecret("x", MASTER);
    expect(await decryptSecret(enc, "a-different-master-key-value-here!!!")).toBeNull();
  });

  it("produces distinct ciphertexts for the same input (random IV)", async () => {
    const a = await encryptSecret("same", MASTER);
    const b = await encryptSecret("same", MASTER);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, MASTER)).toBe("same");
    expect(await decryptSecret(b, MASTER)).toBe("same");
  });

  it("encryptOptional passes null through", async () => {
    expect(await encryptOptional(undefined, MASTER)).toBeNull();
    expect(await encryptOptional("", MASTER)).toBeNull();
  });

  it("decryptSecret tolerates malformed input", async () => {
    expect(await decryptSecret(null, MASTER)).toBeNull();
    expect(await decryptSecret("not-encrypted", MASTER)).toBeNull();
  });
});

describe("simulateConnectionTest", () => {
  it("rejects missing required credentials", () => {
    const r = simulateConnectionTest("encompass", {});
    expect(r.success).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["clientId", "clientSecret", "instanceUrl"]));
  });

  it("rejects a bad instanceUrl", () => {
    const r = simulateConnectionTest("encompass", { clientId: "a", clientSecret: "b", instanceUrl: "not-a-url" });
    expect(r.success).toBe(false);
    expect(r.missing).toContain("instanceUrl");
  });

  it("passes with all required credentials", () => {
    const r = simulateConnectionTest("floify", { apiKey: "key123" });
    expect(r.success).toBe(true);
  });

  it("rejects an unsupported system", () => {
    expect(simulateConnectionTest("nope", {}).success).toBe(false);
  });
});
