import { createClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { recoverMessageAddress } from 'npm:viem@2.37.3';
import { ADDRESS, accountInput, connectionMessage, finiteNumber } from './domain.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const fields = 'wallet_address, signer_address, display_name, verified_at, connected_at';
class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 300) : '';
const activityPageSize = 100;
const activityMaxPages = 5;

// Polymarket Data API v2 (v1 was retired and answers 410): snake_case
// rows in a { data, pagination } envelope, paged by cursor, not offset.
const dataApi = 'https://data-api.polymarket.com/v2';

function rows(body: unknown, what: string) {
  const data = (body as { data?: unknown } | null)?.data;
  if (data === null) return [];
  if (!Array.isArray(data)) throw new RequestError(`Polymarket returned an unexpected ${what} response. Please retry.`, 502);
  return data as Record<string, unknown>[];
}

async function fetchInternationalActivity(wallet: string) {
  const all: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < activityMaxPages; page++) {
    const query = cursor
      ? `cursor=${encodeURIComponent(cursor)}`
      : `limit=${activityPageSize}&sort_by=TIMESTAMP&sort_direction=DESC&type=TRADE`;
    const body = await upstream(`${dataApi}/activity?user=${wallet}&${query}`);
    all.push(...rows(body, 'activity'));
    cursor = (body as { pagination?: { next_cursor?: string | null } }).pagination?.next_cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

// v1's positions (sizeThreshold=0) included resolved-but-unredeemed rows;
// v2 splits those out by status.
async function fetchPositions(wallet: string) {
  const [open, redeemable] = await Promise.all(['OPEN', 'REDEEMABLE'].map(status =>
    upstream(`${dataApi}/positions?user=${wallet}&status=${status}&limit=100&sort_by=CURRENT_VALUE&sort_direction=DESC`)));
  return [...rows(open, 'positions'), ...rows(redeemable, 'positions')]
    .sort((a, b) => (finiteNumber(b.current_value) ?? 0) - (finiteNumber(a.current_value) ?? 0))
    .slice(0, 100);
}

async function upstream(url: string, allowMissing = false) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } });
  if (allowMissing && res.status === 404) return null;
  if (!res.ok) throw new RequestError('Polymarket is temporarily unavailable. Please try again shortly.', 502);
  return await res.json();
}

async function profile(input: unknown) {
  let parsed;
  try { parsed = accountInput(input); }
  catch (e) { throw new RequestError((e as Error).message); }
  let address: string;
  if ('address' in parsed) address = parsed.address;
  else {
    const data = await upstream(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(parsed.username)}&search_profiles=true&limit_per_type=20`);
    const matches = (Array.isArray(data?.profiles) ? data.profiles : []).filter((p: Record<string, unknown>) =>
      [p.name, p.pseudonym].some(n => typeof n === 'string' && n.toLowerCase() === parsed.username.toLowerCase()) && ADDRESS.test(String(p.proxyWallet)));
    if (matches.length !== 1) throw new RequestError('We could not find one exact profile match. Paste the wallet address from your Polymarket profile instead.', 404);
    address = matches[0].proxyWallet.toLowerCase();
  }
  const data = await upstream(`https://gamma-api.polymarket.com/public-profile?address=${address}`, true);
  if (!data || !ADDRESS.test(String(data.proxyWallet))) throw new RequestError('No Polymarket profile found. Use the account wallet address from your Polymarket profile, or connect the wallet you use there.', 404);
  return { wallet_address: data.proxyWallet.toLowerCase(), display_name: text(data.name) || text(data.pseudonym) || 'Polymarket account' };
}

export async function handleConnection(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new RequestError('Sign in to connect an account.', 401);
    const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await auth.auth.getUser();
    if (authError || !user) throw new RequestError('Your session expired. Sign in again.', 401);
    const raw = await req.text();
    if (raw.length > 4_096) throw new RequestError('Request too large.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new RequestError('Invalid request.'); }
    if (!body || typeof body !== 'object') throw new RequestError('Invalid request.');
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (body.action === 'lookup') return reply({ profile: await profile(body.input) });
    if (body.action === 'track') {
      const found = await profile(body.input);
      // A tracked address never inherits ownership from a previous connection.
      const { data, error } = await db.from('polymarket_connections').upsert({
        user_id: user.id, ...found, signer_address: null, verified_at: null, connected_at: new Date().toISOString(),
      }).select(fields).single();
      if (error) throw error;
      return reply({ connection: data });
    }
    if (body.action === 'challenge') {
      if (typeof body.signer !== 'string' || !ADDRESS.test(body.signer)) throw new RequestError('Choose a valid Ethereum wallet.');
      const signer = body.signer.toLowerCase();
      const nonce = crypto.randomUUID();
      const expires = new Date(Date.now() + 5 * 60_000).toISOString();
      const message = connectionMessage(user.id, signer, nonce, expires);
      const { error } = await db.from('polymarket_connection_challenges').upsert({
        user_id: user.id, signer_address: signer, nonce, message, expires_at: expires, created_at: new Date().toISOString(),
      });
      if (error) throw error;
      return reply({ message, nonce });
    }
    if (body.action === 'verify') {
      if (typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) throw new RequestError('Invalid wallet signature. Please reconnect.');
      const { data: challenge, error } = await db.from('polymarket_connection_challenges').select('*').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!challenge || challenge.nonce !== body.nonce || Date.parse(challenge.expires_at) <= Date.now()) throw new RequestError('This connection request expired. Please connect again.');
      let recovered;
      try { recovered = await recoverMessageAddress({ message: challenge.message, signature: body.signature as `0x${string}` }); }
      catch { throw new RequestError('Could not verify that signature. Please reconnect.'); }
      if (recovered.toLowerCase() !== challenge.signer_address) throw new RequestError('The wallet changed. Connect the wallet you use on Polymarket.');
      const { data: claimed } = await db.from('polymarket_connections').select('user_id')
        .eq('signer_address', challenge.signer_address).not('verified_at', 'is', null).neq('user_id', user.id).maybeSingle();
      if (claimed) throw new RequestError('This Polymarket wallet is already connected to another VisibleTrader account. Disconnect it there first, then reconnect here.', 409);
      const found = await profile(challenge.signer_address);
      // Atomic consume makes concurrent requests and captured signatures single-use.
      const { data: consumed, error: consumeError } = await db.from('polymarket_connection_challenges').delete().eq('user_id', user.id).eq('nonce', challenge.nonce).select('nonce');
      if (consumeError) throw consumeError;
      if (!consumed?.length) throw new RequestError('This request was already used. Please reconnect.');
      const { data, error: saveError } = await db.from('polymarket_connections').upsert({
        user_id: user.id, ...found, signer_address: challenge.signer_address,
        verified_at: new Date().toISOString(), connected_at: new Date().toISOString(),
      }).select(fields).single();
      if (saveError) throw saveError;
      return reply({ connection: data });
    }
    if (body.action === 'disconnect') {
      const { error: challengeError } = await db.from('polymarket_connection_challenges').delete().eq('user_id', user.id);
      if (challengeError) throw challengeError;
      const { error } = await db.from('polymarket_connections').delete().eq('user_id', user.id);
      if (error) throw error;
      return reply({ disconnected: true });
    }
    if (body.action === 'snapshot') {
      const { data: connection, error } = await db.from('polymarket_connections').select(fields).eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!connection) return reply({ connection: null });
      // Public Data API v2; no credentials (not the CLOB API).
      const wallet = connection.wallet_address;
      const [positions, activity] = await Promise.all([
        fetchPositions(wallet),
        fetchInternationalActivity(wallet),
      ]);
      return reply({
        connection, fetched_at: new Date().toISOString(), positions_limited: positions.length === 100,
        activity_limited: activity.length >= 500,
        positions: positions.map(p => ({
          asset: text(p.token_id), title: text(p.title), outcome: text(p.outcome), size: finiteNumber(p.current_size),
          current_value: finiteNumber(p.current_value), cash_pnl: finiteNumber(p.unrealized_pnl), redeemable: p.redeemable === true,
        })),
        // v2 activity rows carry no per-trade P&L (v1's usdcPnl); pnl stays null.
        activity: activity.map(a => ({
          transaction_hash: text(a.transaction_hash), asset: text(a.token_id), timestamp: finiteNumber(a.timestamp),
          title: text(a.title), outcome: text(a.outcome), side: a.side === 'BUY' ? 'Buy' : a.side === 'SELL' ? 'Sell' : 'Trade',
          amount: finiteNumber(a.usdc_size), size: finiteNumber(a.size), price: finiteNumber(a.price),
          pnl: null,
        })),
      });
    }
    throw new RequestError('Unknown connection action.');
  } catch (e) {
    // Never return upstream bodies, SQL details, auth headers, or signatures.
    if (e instanceof RequestError) return reply({ error: e.message }, e.status);
    // Backstop for the rare race the pre-check misses: two verifications for
    // the same wallet racing past the select before either upsert commits.
    if ((e as { code?: string })?.code === '23505') {
      return reply({ error: 'This Polymarket wallet is already connected to another VisibleTrader account. Disconnect it there first, then reconnect here.' }, 409);
    }
    return reply({ error: 'Could not complete the connection request. Please try again.' }, 500);
  }
}
