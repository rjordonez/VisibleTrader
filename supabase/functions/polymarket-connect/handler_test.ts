import { strict as assert } from 'node:assert';
import { privateKeyToAccount } from 'npm:viem@2.37.3/accounts';
import { handleConnection } from './handler.ts';
import { accountInput, finiteNumber } from './domain.ts';

const alice = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const mallory = privateKeyToAccount(`0x${'2'.repeat(64)}`);
const wallet = `0x${'a'.repeat(40)}`;
const userId = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
type Row = Record<string, unknown>;

Deno.test('profile input accepts accounts, rejects foreign URLs and malformed addresses', () => {
  assert.deepEqual(accountInput(` https://polymarket.com/profile/${wallet}?tab=activity `), { address: wallet });
  assert.deepEqual(accountInput('https://polymarket.com/@alice'), { username: 'alice' });
  assert.deepEqual(accountInput('0x8dxd'), { username: '0x8dxd' });
  assert.deepEqual(accountInput(alice.address), { address: alice.address.toLowerCase() });
  for (const input of ['https://polymarket.us/@alice', 'https://polymarket.com.evil.test/@alice', 'https://polymarket.com@evil.test/@alice', 'http://polymarket.com/@alice', 'https://polymarket.com/event/test', '0x123', 'https://polymarket.com/@%2Fsecret', '', null]) {
    assert.throws(() => accountInput(input));
  }
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber(''), null);
  assert.equal(finiteNumber('Infinity'), null);
  assert.equal(finiteNumber('12.3'), 12.3);
});

Deno.test('connection boundary: JWT, ownership, replay, expiry, isolation and upstream failures', async t => {
  const originalFetch = globalThis.fetch;
  const savedEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, Deno.env.get(key)] as const);
  Deno.env.set('SUPABASE_URL', 'https://dev.example.test');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  const connections = new Map<string, Row>();
  const challenges = new Map<string, Row>();
  let failUpstream = false;
  let profileMissing = false;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') {
      const token = request.headers.get('authorization');
      if (!['Bearer alice-token', 'Bearer other-token'].includes(token ?? '')) return response({ message: 'bad token' }, 401);
      return response({ id: token === 'Bearer alice-token' ? userId : otherUser, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    if (url.host === 'gamma-api.polymarket.com') {
      if (failUpstream) return response({ error: 'sensitive upstream internals' }, 503);
      if (profileMissing) return response({ error: 'not found' }, 404);
      assert.equal(url.pathname, '/public-profile');
      return response({ proxyWallet: wallet, name: 'Alice' });
    }
    if (url.host === 'data-api.polymarket.com') {
      assert.equal(url.searchParams.get('user'), wallet, 'read only the saved account, never caller-supplied address');
      if (failUpstream) return response({ error: 'provider down' }, 500);
      if (url.pathname === '/positions') return response([{ asset: 'yes', title: 'Test', outcome: 'Yes', size: 10, currentValue: 6, cashPnl: 1 }]);
      assert.equal(url.searchParams.get('limit'), '100');
      return response(url.searchParams.get('offset') === '0' ? [] : []);
    }
    const table = url.pathname.split('/').pop();
    const records = table === 'polymarket_connections' ? connections : table === 'polymarket_connection_challenges' ? challenges : null;
    assert.ok(records, `Unexpected route ${url.pathname}`);
    if (request.method === 'POST') {
      const row = await request.json();
      records.set(row.user_id, row);
      return response(request.headers.get('accept')?.includes('vnd.pgrst.object') ? row : [row]);
    }
    const id = url.searchParams.get('user_id')?.replace(/^eq\./, '');
    assert.ok(id, 'every database query must be user-scoped');
    const row = records.get(id);
    if (request.method === 'DELETE') {
      const nonce = url.searchParams.get('nonce')?.replace(/^eq\./, '');
      if (row && (!nonce || row.nonce === nonce)) { records.delete(id); return response([row]); }
      return response([]);
    }
    return response(request.headers.get('accept')?.includes('vnd.pgrst.object') ? row ?? null : row ? [row] : []);
  };
  async function call(body: Row, token = 'alice-token') {
    const res = await handleConnection(new Request('https://dev.example.test/functions/v1/polymarket-connect', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: res.status, data: await res.json() };
  }
  try {
    await t.step('requires a valid signed-in user', async () => {
      assert.equal((await call({ action: 'challenge', signer: alice.address }, 'invalid')).status, 401);
      assert.equal(challenges.size, 0);
    });
    await t.step('a tracked profile is never represented as verified ownership', async () => {
      const result = await call({ action: 'track', input: wallet, verified_at: new Date().toISOString(), signer_address: alice.address });
      assert.equal(result.status, 200);
      assert.equal(result.data.connection.verified_at, null);
      assert.equal(result.data.connection.signer_address, null);
    });
    await t.step('rejects another signer, accepts the owner, rejects replay and cross-user reuse', async () => {
      const challenge = (await call({ action: 'challenge', signer: alice.address })).data;
      const wrong = await mallory.signMessage({ message: challenge.message });
      assert.equal((await call({ action: 'verify', nonce: challenge.nonce, signature: wrong })).status, 400);
      const signature = await alice.signMessage({ message: challenge.message });
      const signed = { action: 'verify', nonce: challenge.nonce, signature };
      assert.equal((await call(signed, 'other-token')).status, 400);
      const result = await call(signed);
      assert.equal(result.status, 200);
      assert.equal(result.data.connection.signer_address, alice.address.toLowerCase());
      assert.ok(result.data.connection.verified_at);
      assert.equal((await call(signed)).status, 400);
    });
    await t.step('expired challenges cannot connect', async () => {
      const challenge = (await call({ action: 'challenge', signer: alice.address })).data;
      challenges.get(userId)!.expires_at = new Date(Date.now() - 1).toISOString();
      const signature = await alice.signMessage({ message: challenge.message });
      assert.equal((await call({ action: 'verify', nonce: challenge.nonce, signature })).status, 400);
    });
    await t.step('missing profiles do not replace a working connection', async () => {
      profileMissing = true;
      assert.equal((await call({ action: 'track', input: mallory.address })).status, 404);
      assert.equal(connections.get(userId)!.wallet_address, wallet);
      profileMissing = false;
    });
    await t.step('snapshot ignores caller account, scopes data to authenticated user', async () => {
      const result = await call({ action: 'snapshot', input: mallory.address });
      assert.equal(result.status, 200);
      assert.equal(result.data.positions[0].current_value, 6);
      assert.equal((await call({ action: 'snapshot' }, 'other-token')).data.connection, null);
    });
    await t.step('upstream failures do not masquerade as an empty portfolio', async () => {
      failUpstream = true;
      const result = await call({ action: 'snapshot' });
      assert.equal(result.status, 502);
      assert.equal(result.data.positions, undefined);
      assert.ok(!result.data.error.includes('sensitive'));
      failUpstream = false;
    });
    await t.step('disconnect deletes metadata and challenges only for the current user', async () => {
      await call({ action: 'track', input: wallet }, 'other-token');
      assert.equal((await call({ action: 'disconnect' })).status, 200);
      assert.equal(connections.has(userId), false);
      assert.equal(challenges.has(userId), false);
      assert.equal(connections.has(otherUser), true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of savedEnv) { if (value == null) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
});
