// Signing client for Polymarket US's authenticated retail API. Endpoint
// shapes verified directly against docs.polymarket.us on 2026-09-11:
// api-reference/authentication, api-reference/portfolio/get-user-positions,
// api-reference/portfolio/get-activities. Read-only: no order/trading
// endpoint is called anywhere in this file.
import { finiteNumber, money, unixSeconds } from './domain.ts';

export class USApiError extends Error {}

async function importSigner(secretKey: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(secretKey), c => c.charCodeAt(0));
  } catch {
    throw new USApiError('Enter the complete Secret Key from Polymarket US’s developer portal.');
  }
  if (raw.length < 32) throw new USApiError('Enter the complete Secret Key from Polymarket US’s developer portal.');
  // RFC 8410 PKCS#8 wrapper around a raw 32-byte Ed25519 seed — WebCrypto
  // only accepts Ed25519 private keys in pkcs8 form, never raw.
  const der = new Uint8Array(48);
  der.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  der.set(raw.slice(0, 32), 16);
  try {
    return await crypto.subtle.importKey('pkcs8', der, 'Ed25519', false, ['sign']);
  } catch {
    throw new USApiError('Enter the complete Secret Key from Polymarket US’s developer portal.');
  }
}

async function signedGet(keyId: string, signer: CryptoKey, path: string, params: URLSearchParams) {
  const timestamp = String(Date.now());
  const signatureBytes = await crypto.subtle.sign('Ed25519', signer, new TextEncoder().encode(`${timestamp}GET${path}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  const res = await fetch(`https://api.polymarket.us${path}?${params}`, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
    headers: { 'X-PM-Access-Key': keyId, 'X-PM-Timestamp': timestamp, 'X-PM-Signature': signature, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new USApiError('Polymarket US rejected these credentials. Check your key or create a new one in its developer portal.');
  }
  if (res.status === 429) throw new USApiError('Polymarket US is limiting requests. Please wait a minute and try again.');
  if (!res.ok) {
    // TEMPORARY diagnostic log — remove once the real failure mode is confirmed.
    console.error('polymarket-us-connect upstream error', path, res.status, (await res.text()).slice(0, 500));
    throw new USApiError('Polymarket US is temporarily unavailable. Please try again shortly.');
  }
  return await res.json();
}

export async function verifyCredentials(keyId: string, secretKey: string) {
  const signer = await importSigner(secretKey);
  // A cheap, bounded read: enough to confirm the credentials actually work
  // before we ever store them.
  await signedGet(keyId, signer, '/v1/portfolio/positions', new URLSearchParams({ limit: '1' }));
}

export async function fetchPositions(keyId: string, secretKey: string) {
  const signer = await importSigner(secretKey);
  const data = await signedGet(keyId, signer, '/v1/portfolio/positions', new URLSearchParams({ limit: '100' }));
  const positions = data && typeof data.positions === 'object' ? data.positions : {};
  return Object.entries(positions as Record<string, Record<string, unknown>>).map(([slug, p]) => {
    const metadata = (p.marketMetadata ?? {}) as Record<string, unknown>;
    return {
      asset: slug,
      title: typeof metadata.title === 'string' ? metadata.title : slug.replaceAll('-', ' '),
      outcome: typeof metadata.outcome === 'string' ? metadata.outcome : '',
      size: finiteNumber(p.netPositionDecimal),
      current_value: money(p.cashValue),
      cash_pnl: money(p.realized),
      redeemable: p.expired === true,
    };
  });
}

export async function fetchActivity(keyId: string, secretKey: string) {
  const signer = await importSigner(secretKey);
  // `types` filter omitted: its accepted enum string isn't documented precisely
  // enough to guess safely, and trade-shaped entries are already filtered below.
  const data = await signedGet(keyId, signer, '/v1/portfolio/activities', new URLSearchParams({ limit: '50' }));
  const activities = Array.isArray(data?.activities) ? data.activities : [];
  return activities
    .filter((a: Record<string, unknown>) => a.trade && typeof a.trade === 'object')
    .map((a: Record<string, unknown>) => {
      const trade = a.trade as Record<string, unknown>;
      return {
        transaction_hash: typeof trade.id === 'string' ? trade.id : '',
        asset: typeof trade.marketSlug === 'string' ? trade.marketSlug : '',
        timestamp: unixSeconds(trade.createTime),
        title: typeof trade.marketSlug === 'string' ? trade.marketSlug.replaceAll('-', ' ') : '',
        outcome: '',
        side: 'Trade',
        amount: money(trade.costBasis),
        size: finiteNumber(trade.qtyDecimal),
        price: money(trade.price),
      };
    });
}
