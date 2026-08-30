function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}

/** 6-digit pairing code, zero-padded. */
export function pairingCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export function newSalt(): string {
  return randomToken(16);
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
