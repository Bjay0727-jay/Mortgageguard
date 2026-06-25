import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSchema, registerInviteSchema, changePasswordSchema } from "../routes/auth";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("public registration is privilege-safe", () => {
  it("does not accept a client-supplied role or companyId", () => {
    const parsed = registerSchema.parse({
      email: "owner@acme.com",
      password: "password123",
      name: "Owner",
      companyName: "Acme Mortgage",
      // Attacker attempts to escalate / join an existing company:
      role: "company_admin",
      companyId: "11111111-1111-1111-1111-111111111111",
    } as Record<string, unknown>);

    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("companyId");
    expect(parsed.companyName).toBe("Acme Mortgage");
  });

  it("requires a company name", () => {
    const res = registerSchema.safeParse({ email: "a@b.com", password: "password123", name: "A" });
    expect(res.success).toBe(false);
  });
});

describe("invite registration takes role/company/email from the invite only", () => {
  it("schema exposes no role, companyId, or email field", () => {
    const keys = Object.keys(registerInviteSchema.shape);
    expect(keys).toEqual(expect.arrayContaining(["token", "name", "password"]));
    expect(keys).not.toContain("role");
    expect(keys).not.toContain("companyId");
    expect(keys).not.toContain("email");
  });

  it("strips an injected role", () => {
    const parsed = registerInviteSchema.parse({
      token: "abc",
      name: "Invitee",
      password: "password123",
      role: "company_admin",
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("role");
  });

  it("requires a token", () => {
    expect(registerInviteSchema.safeParse({ name: "x", password: "password123" }).success).toBe(false);
  });
});

describe("change-password schema", () => {
  it("requires a new password of at least 8 chars and allows omitting current", () => {
    expect(changePasswordSchema.safeParse({ newPassword: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ newPassword: "longenough" }).success).toBe(true);
  });
});

describe("seeded admin db-setup", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../scripts/db-setup.sql"), "utf8");

  it("seeds the admin with must_change_password = true", () => {
    // INSERT lists must_change_password and provides `true`.
    expect(sql).toMatch(/INSERT INTO users[\s\S]*must_change_password[\s\S]*admin@mortgageguard\.com/);
    expect(sql).toMatch(/admin@mortgageguard\.com[\s\S]*?true\s*\)/);
  });

  it("self-heals the seeded admin to force a password change", () => {
    expect(sql).toMatch(/UPDATE users[\s\S]*must_change_password = true[\s\S]*admin@mortgageguard\.com/);
    expect(sql).toMatch(/last_login_at IS NULL/);
  });
});
