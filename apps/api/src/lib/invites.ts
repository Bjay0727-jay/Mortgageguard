// ─────────────────────────────────────────────────────
// MortgageGuard — User invitation tokens & validation
// ─────────────────────────────────────────────────────

// Days an invite stays valid for.
export const INVITE_TTL_DAYS = 7;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate a secure random invite token and its SHA-256 hash. Only the hash is
// ever stored; the raw token is returned once (in the invite URL) and cannot be
// recovered from the database.
export async function createInviteToken(): Promise<{ token: string; tokenHash: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  return { token, tokenHash };
}

export function inviteExpiry(nowMs: number): string {
  return new Date(nowMs + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface InviteRow {
  revoked_at?: string | null;
  accepted_at?: string | null;
  expires_at?: string | null;
}

export interface InviteCheck {
  ok: boolean;
  status?: number;
  error?: string;
  code?: string;
}

// Pure validation of an invite row. Order matters: not-found → revoked →
// already-used → expired. Returns clear, user-facing messages.
export function validateInvite(invite: InviteRow | undefined | null, nowMs: number): InviteCheck {
  if (!invite) {
    return { ok: false, status: 404, error: "Invitation not found", code: "INVITE_NOT_FOUND" };
  }
  if (invite.revoked_at) {
    return { ok: false, status: 410, error: "This invitation has been revoked", code: "INVITE_REVOKED" };
  }
  if (invite.accepted_at) {
    return { ok: false, status: 409, error: "This invitation has already been used", code: "INVITE_USED" };
  }
  if (!invite.expires_at || new Date(invite.expires_at).getTime() < nowMs) {
    return { ok: false, status: 410, error: "This invitation has expired", code: "INVITE_EXPIRED" };
  }
  return { ok: true };
}
