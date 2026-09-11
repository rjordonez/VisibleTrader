import { strict as assert } from 'node:assert';
import { fetchPortfolio, USApiError, verifyCredentials } from './us.ts';

const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const key = '00000000-0000-4000-8000-000000000001';

async function mockReads(statuses: Record<string, number>, run: (calls: URL[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('X-PM-Access-Key'), key);
    const status = statuses[url.pathname] ?? 200;
    const body = url.pathname.endsWith('activities') ? { activities: [] } : { positions: {} };
    return Promise.resolve(new Response(JSON.stringify(status === 200 ? body : { code: 14 }), { status }));
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

Deno.test('verification uses authenticated activity even when positions is unavailable', async () => {
  await mockReads({ '/v1/portfolio/positions': 503 }, async calls => {
    await verifyCredentials(key, secret);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/v1/portfolio/activities');
    assert.equal(calls[0].searchParams.get('limit'), '1');
  });
});

Deno.test('positions failure preserves activity and omits unavailable positions', async () => {
  await mockReads({ '/v1/portfolio/positions': 503 }, async () => {
    const result = await fetchPortfolio(key, secret);
    assert.equal(result.positions, undefined);
    assert.deepEqual(result.activity, []);
    assert.ok(result.resource_errors.positions);
  });
});

Deno.test('activity failure preserves positions', async () => {
  await mockReads({ '/v1/portfolio/activities': 503 }, async () => {
    const result = await fetchPortfolio(key, secret);
    assert.deepEqual(result.positions, []);
    assert.equal(result.activity, undefined);
    assert.ok(result.resource_errors.activity);
  });
});

Deno.test('invalid credentials cannot be saved or hidden behind partial success', async () => {
  await mockReads({ '/v1/portfolio/activities': 401 }, async () => {
    await assert.rejects(() => verifyCredentials(key, secret), (e: unknown) => e instanceof USApiError && e.status === 401);
    await assert.rejects(() => fetchPortfolio(key, secret), (e: unknown) => e instanceof USApiError && e.status === 401);
  });
});

Deno.test('total upstream failure is an error, not an empty portfolio', async () => {
  await mockReads({ '/v1/portfolio/positions': 503, '/v1/portfolio/activities': 503 }, async () => {
    await assert.rejects(() => fetchPortfolio(key, secret), /positions and activity are unavailable/);
  });
});
