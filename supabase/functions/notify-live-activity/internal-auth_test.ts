import { strict as assert } from 'node:assert';
import { createInternalHandler } from './internal-auth.ts';

Deno.test('only the internal credential can execute notification side effects', async () => {
  let sends = 0;
  const handler = createInternalHandler(async () => {
    sends++;
    return new Response(JSON.stringify({ sent: 2, failed: 0 }));
  }, () => 'test-internal-key');
  for (const token of ['', 'Bearer public-anon-key', 'Bearer signed-in-user-jwt', 'Bearer test-internal-key-extra']) {
    const response = await handler(new Request('https://test.local', { method: 'POST', headers: { authorization: token } }));
    assert.equal(response.status, 403);
  }
  assert.equal(sends, 0);
  assert.equal((await handler(new Request('https://test.local'))).status, 405);
  const allowed = await handler(new Request('https://test.local', { method: 'POST', headers: { authorization: 'Bearer test-internal-key' } }));
  assert.equal(allowed.status, 200);
  assert.equal(sends, 1);
  assert.deepEqual(await allowed.json(), { sent: 2, failed: 0 });
});

Deno.test('missing configuration and internal errors fail closed without secret details', async () => {
  const request = () => new Request('https://test.local', { method: 'POST', headers: { authorization: 'Bearer internal' } });
  const missing = createInternalHandler(() => { throw new Error('must not execute'); }, () => undefined);
  assert.equal((await missing(request())).status, 503);
  const broken = createInternalHandler(() => { throw new Error('private credential details'); }, () => 'internal');
  const response = await broken(request());
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('private credential'), false);
});
