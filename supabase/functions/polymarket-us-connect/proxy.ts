// Client for the isolated Cloud Run service that holds the only credential
// able to use the Cloud KMS key. This function never talks to KMS directly
// and never holds a GCP credential of its own — see cloud-run/polymarket-us-kms-proxy.
const PROXY_URL = Deno.env.get('POLYMARKET_US_KMS_PROXY_URL')!;
const PROXY_SECRET = Deno.env.get('POLYMARKET_US_KMS_PROXY_SECRET')!;

async function call(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${PROXY_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Could not secure your connection. Please try again shortly.');
  return await res.json();
}

export async function kmsEncrypt(plaintext: string): Promise<{ ciphertext: string; keyVersion: string }> {
  const data = await call('/encrypt', { plaintext });
  if (typeof data.ciphertext !== 'string') throw new Error('Could not secure your connection. Please try again shortly.');
  return { ciphertext: data.ciphertext, keyVersion: typeof data.name === 'string' ? data.name : 'unknown' };
}

export async function kmsDecrypt(ciphertext: string): Promise<string> {
  const data = await call('/decrypt', { ciphertext });
  if (typeof data.plaintext !== 'string') throw new Error('Could not restore your connection. Please reconnect.');
  return data.plaintext;
}
