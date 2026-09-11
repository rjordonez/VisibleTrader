// Pure parsing shared with tests. Never accept arbitrary fetch URLs.
export const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCredentialInput(input: unknown): { keyId: string; secretKey: string } {
  if (!input || typeof input !== 'object') throw new Error('Enter your Polymarket US Key ID and Secret Key.');
  const { keyId, secretKey } = input as Record<string, unknown>;
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
    throw new Error('Enter the Key ID from Polymarket US’s developer portal.');
  }
  if (typeof secretKey !== 'string' || !secretKey.trim()) {
    throw new Error('Enter the Secret Key from Polymarket US’s developer portal.');
  }
  return { keyId, secretKey: secretKey.trim() };
}

export function finiteNumber(value: unknown) {
  if (typeof value === 'string' && !value.trim()) return null;
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function money(amount: unknown): number | null {
  if (!amount || typeof amount !== 'object') return null;
  const { value, currency } = amount as Record<string, unknown>;
  if (typeof currency === 'string' && currency !== 'USD') return null;
  return finiteNumber(value);
}

export function unixSeconds(value: unknown) {
  return typeof value === 'string' ? Math.floor(Date.parse(value) / 1000) : null;
}
