import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, resolveChangePassword, PBKDF2_ITERATIONS } from "./passwords";

describe("password hashing", () => {
  it("uses the production PBKDF2 iteration count", () => {
    expect(PBKDF2_ITERATIONS).toBe(600000);
  });

  it("round-trips a password in pbkdf2:salt:hash format", async () => {
    const stored = await hashPassword("CorrectHorse!9");
    expect(stored.startsWith("pbkdf2:")).toBe(true);
    expect(stored.split(":")).toHaveLength(3);
    expect(await verifyPassword("CorrectHorse!9", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("CorrectHorse!9");
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-pbkdf2")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2::")).toBe(false);
  });
});

describe("resolveChangePassword", () => {
  const storedHash = "pbkdf2:aa:bb";

  it("skips the current-password check when must_change_password is set", async () => {
    const res = await resolveChangePassword({ mustChangePassword: true, storedHash, verify: async () => false });
    expect(res.ok).toBe(true);
  });

  it("requires a current password otherwise", async () => {
    const res = await resolveChangePassword({ mustChangePassword: false, storedHash, verify: async () => true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.code).toBe("CURRENT_PASSWORD_REQUIRED");
  });

  it("rejects an incorrect current password", async () => {
    const res = await resolveChangePassword({ mustChangePassword: false, currentPassword: "nope", storedHash, verify: async () => false });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.code).toBe("CURRENT_PASSWORD_INVALID");
  });

  it("allows the change with a valid current password", async () => {
    const res = await resolveChangePassword({ mustChangePassword: false, currentPassword: "right", storedHash, verify: async () => true });
    expect(res.ok).toBe(true);
  });
});
