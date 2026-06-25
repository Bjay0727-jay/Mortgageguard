// ─────────────────────────────────────────────────────
// MortgageGuard — Secret encryption at rest (AES-256-GCM)
// Integration credentials (clientSecret, apiKey, webhook secret) are encrypted
// with a key derived from JWT_SECRET via HKDF before being stored, and are never
// returned by the API. Format: "v1:<ivHex>:<cipherHex>".
// ─────────────────────────────────────────────────────

const hex = (arr: Uint8Array) => Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => new Uint8Array(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

async function deriveKey(masterSecret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(masterSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("mg-integration-secrets-v1"), info: new TextEncoder().encode("aes-gcm") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(plain: string, masterSecret: string): Promise<string> {
  if (!masterSecret) throw new Error("encryptSecret: master secret is required");
  const key = await deriveKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `v1:${hex(iv)}:${hex(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string | null | undefined, masterSecret: string): Promise<string | null> {
  if (!stored || !stored.startsWith("v1:")) return null;
  const [, ivHex, ctHex] = stored.split(":");
  if (!ivHex || !ctHex) return null;
  try {
    const key = await deriveKey(masterSecret);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(ivHex) }, key, fromHex(ctHex));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// Encrypt only when a value is present; pass through null otherwise.
export async function encryptOptional(plain: string | null | undefined, masterSecret: string): Promise<string | null> {
  return plain ? encryptSecret(plain, masterSecret) : null;
}
