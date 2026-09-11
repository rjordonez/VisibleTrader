// Signing client for Polymarket US's authenticated retail API. Endpoint
// shapes verified directly against docs.polymarket.us on 2026-09-11:
// api-reference/authentication, api-reference/portfolio/get-user-positions,
// api-reference/portfolio/get-activities. Read-only: no order/trading
// endpoint is called anywhere in this file.
import { finiteNumber, money, unixSeconds } from './domain.ts';

export class USApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

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
    throw new USApiError('Polymarket US rejected these credentials. Check your key or create a new one in its developer portal.', res.status);
  }
  if (res.status === 429) throw new USApiError('Polymarket US is limiting requests. Please wait a minute and try again.');
  if (!res.ok) {
    console.error('polymarket-us-connect upstream error', path, res.status);
    throw new USApiError('Polymarket US is temporarily unavailable. Please try again shortly.', res.status);
  }
  return await res.json();
}

export async function verifyCredentials(keyId: string, secretKey: string) {
  const signer = await importSigner(secretKey);
  // A cheap, bounded read: enough to confirm the credentials actually work
  // before we ever store them.
  const data = await signedGet(keyId, signer, '/v1/portfolio/activities', new URLSearchParams({ limit: '1' }));
  if (!Array.isArray(data?.activities)) throw new USApiError('Polymarket US returned an invalid verification response. Please try again.');
}

export async function fetchPositions(keyId: string, secretKey: string) {
  const signer = await importSigner(secretKey);
  const data = await signedGet(keyId, signer, '/v1/portfolio/positions', new URLSearchParams({ limit: '100' }));
  if (!data?.positions || typeof data.positions !== 'object' || Array.isArray(data.positions)) {
    throw new USApiError('Polymarket US returned invalid position data. Please try again.');
  }
  const positions = data.positions;
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
  const activities: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let complete = false;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const data = await signedGet(keyId, signer, '/v1/portfolio/activities', params);
    if (!Array.isArray(data?.activities)) throw new USApiError('Polymarket US returned invalid activity data. Please try again.');
    activities.push(...data.activities);
    if (data.eof === true || typeof data.nextCursor !== 'string' || !data.nextCursor || data.activities.length < 100) { complete = true; break; }
    cursor = data.nextCursor;
  }
  const trades = mapActivities(activities).map(t => ({
    transaction_hash: t.external_id, asset: t.asset, timestamp: unixSeconds(t.occurred_at),
    title: t.title, outcome: t.outcome, side: t.side, amount: t.amount,
    pnl: t.realized_pnl, size: t.size, price: t.price,
  }));
  return { trades, limited: !complete };
}

export interface TradeRecord {
  external_id: string; occurred_at: string; asset: string; title: string;
  outcome: string; side: string; size: number | null; price: number | null;
  amount: number | null; realized_pnl: number | null;
}

function mapTrade(trade: Record<string, unknown>): TradeRecord | null {
  if (typeof trade.id !== 'string' || typeof trade.marketSlug !== 'string' || typeof trade.createTime !== 'string') return null;
  return {
    external_id: trade.id, occurred_at: trade.createTime, asset: trade.marketSlug,
    title: trade.marketSlug.replaceAll('-', ' '), outcome: '', side: 'Trade',
    size: finiteNumber(trade.qtyDecimal), price: money(trade.price),
    amount: money(trade.costBasis), realized_pnl: money(trade.realizedPnl),
  };
}

// A position that closes because its market resolves (rather than the user
// selling out) reports its P&L here, not on a trade — verified against a
// real account: only trades with an offsetting sell carry realizedPnl, but
// most positions in practice close via resolution. Skipping this activity
// type silently drops the majority of a user's realized P&L.
function mapResolution(resolution: Record<string, unknown>): TradeRecord | null {
  // `tradeId` is documented but observed empty ("") on every real resolution
  // seen so far — an empty string is falsy, so this must not gate on it.
  // marketSlug + updateTime (nanosecond precision) is unique enough instead.
  const marketSlug = typeof resolution.marketSlug === 'string' ? resolution.marketSlug : null;
  const updateTime = typeof resolution.updateTime === 'string' ? resolution.updateTime : null;
  if (!marketSlug || !updateTime) return null;
  const before = money((resolution.beforePosition as Record<string, unknown> | undefined)?.realized);
  const after = money((resolution.afterPosition as Record<string, unknown> | undefined)?.realized);
  if (before === null || after === null) return null;
  const metadata = ((resolution.afterPosition as Record<string, unknown> | undefined)?.marketMetadata
    ?? (resolution.beforePosition as Record<string, unknown> | undefined)?.marketMetadata ?? {}) as Record<string, unknown>;
  return {
    external_id: `resolution:${marketSlug}:${updateTime}`,
    occurred_at: updateTime, asset: marketSlug,
    title: typeof metadata.title === 'string' && metadata.title ? metadata.title : marketSlug.replaceAll('-', ' '),
    outcome: typeof metadata.outcome === 'string' ? metadata.outcome : '',
    side: 'Settlement', size: null, price: null, amount: null, realized_pnl: after - before,
  };
}

function mapActivities(activities: Record<string, unknown>[]): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const a of activities) {
    if (a.trade && typeof a.trade === 'object') {
      const t = mapTrade(a.trade as Record<string, unknown>);
      if (t) out.push(t);
    } else if (a.positionResolution && typeof a.positionResolution === 'object') {
      const r = mapResolution(a.positionResolution as Record<string, unknown>);
      if (r) out.push(r);
    }
  }
  return out;
}

// One page of trade history for the backfill/resync loop in handler.ts —
// kept separate from fetchActivity (which serves the live snapshot view)
// since callers here need the raw cursor to persist between invocations.
export async function fetchActivityPage(keyId: string, secretKey: string, cursor: string | null) {
  const signer = await importSigner(secretKey);
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.set('cursor', cursor);
  const data = await signedGet(keyId, signer, '/v1/portfolio/activities', params);
  if (!Array.isArray(data?.activities)) throw new USApiError('Polymarket US returned invalid activity data. Please try again.');
  const trades = mapActivities(data.activities as Record<string, unknown>[]);
  return { trades, nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null, eof: data.eof === true };
}

// An unavailable portfolio service must not discard a successful activity read.
// Omitted resources mean unavailable; an empty array means a successful empty read.
export async function fetchPortfolio(keyId: string, secretKey: string) {
  const [positions, activity] = await Promise.allSettled([
    fetchPositions(keyId, secretKey), fetchActivity(keyId, secretKey),
  ]);
  for (const result of [positions, activity]) {
    if (result.status === 'rejected' && result.reason instanceof USApiError &&
        (result.reason.status === 401 || result.reason.status === 403)) throw result.reason;
  }
  if (positions.status === 'rejected' && activity.status === 'rejected') {
    throw new USApiError('Polymarket US positions and activity are unavailable. Your connection is saved; try again shortly.');
  }
  return {
    positions: positions.status === 'fulfilled' ? positions.value : undefined,
    activity: activity.status === 'fulfilled' ? activity.value.trades : undefined,
    activity_limited: activity.status === 'fulfilled' && activity.value.limited,
    positions_limited: positions.status === 'fulfilled' && positions.value.length === 100,
    resource_errors: {
      ...(positions.status === 'rejected' ? { positions: 'Polymarket US positions are currently unavailable. Activity is still available in Trades.' } : {}),
      ...(activity.status === 'rejected' ? { activity: 'Polymarket US activity is currently unavailable. Your positions are still available.' } : {}),
    },
  };
}
