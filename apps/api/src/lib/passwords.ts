// ─────────────────────────────────────────────────────
// MortgageGuard — Password hashing (PBKDF2-SHA256)
// ─────────────────────────────────────────────────────
//
// IMPORTANT: MortgageGuard stores PBKDF2-SHA256 hashes with 600000 iterations.
// hashPassword and verifyPassword must always use the same count so
// stored hashes keep verifying.
export const PBKDF2_ITERATIONS = 600000;

const hex = (arr: Uint8Array) =>
  Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return `pbkdf2:${hex(salt)}:${hex(new Uint8Array(hash))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith("pbkdf2:")) return false;
  const [, saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const matched = saltHex.match(/.{2}/g);
  if (!matched) return false;
  const salt = new Uint8Array(matched.map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(hash)) === hashHex;
}

export interface ChangePasswordCheck {
  ok: boolean;
  status?: number;
  error?: string;
  code?: string;
}

// Pure decision logic for the change-password endpoint. When the account is
// flagged must_change_password (e.g. the seeded admin on first login) the
// current password is not required; otherwise it must be supplied and valid.
// `verify` is injected so this stays unit-testable without WebCrypto.
export async function resolveChangePassword(opts: {
  mustChangePassword: boolean;
  currentPassword?: string;
  storedHash: string;
  verify?: (password: string, stored: string) => Promise<boolean>;
}): Promise<ChangePasswordCheck> {
  const verify = opts.verify ?? verifyPassword;
  if (!opts.mustChangePassword) {
    if (!opts.currentPassword) {
      return { ok: false, status: 400, error: "Current password is required", code: "CURRENT_PASSWORD_REQUIRED" };
    }
    if (!(await verify(opts.currentPassword, opts.storedHash))) {
      return { ok: false, status: 401, error: "Current password is incorrect", code: "CURRENT_PASSWORD_INVALID" };
    }
  }
  return { ok: true };
}
