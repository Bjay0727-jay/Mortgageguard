import { describe, it, expect } from "vitest";
import { createInviteToken, sha256Hex, validateInvite, inviteExpiry } from "./invites";

describe("invite tokens", () => {
  it("creates a url-safe random token whose stored hash matches sha256(token)", async () => {
    const { token, tokenHash } = await createInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no +/=
    expect(tokenHash).toBe(await sha256Hex(token));
    expect(tokenHash).not.toBe(token); // never store the raw token
  });

  it("produces unique tokens", async () => {
    const a = await createInviteToken();
    const b = await createInviteToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe("validateInvite", () => {
  const future = () => new Date(Date.now() + 60_000).toISOString();
  const past = () => new Date(Date.now() - 60_000).toISOString();

  it("rejects a missing invite", () => {
    const r = validateInvite(undefined, Date.now());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.code).toBe("INVITE_NOT_FOUND");
  });

  it("rejects a revoked invite", () => {
    const r = validateInvite({ revoked_at: past(), expires_at: future() }, Date.now());
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVITE_REVOKED");
  });

  it("rejects an already-accepted invite", () => {
    const r = validateInvite({ accepted_at: past(), expires_at: future() }, Date.now());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe("INVITE_USED");
  });

  it("rejects an expired invite", () => {
    const r = validateInvite({ expires_at: past() }, Date.now());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(410);
    expect(r.code).toBe("INVITE_EXPIRED");
  });

  it("revoked takes precedence over expired", () => {
    const r = validateInvite({ revoked_at: past(), expires_at: past() }, Date.now());
    expect(r.code).toBe("INVITE_REVOKED");
  });

  it("accepts a live invite", () => {
    const r = validateInvite({ expires_at: future() }, Date.now());
    expect(r.ok).toBe(true);
  });

  it("inviteExpiry is in the future", () => {
    expect(new Date(inviteExpiry(Date.now())).getTime()).toBeGreaterThan(Date.now());
  });
});
