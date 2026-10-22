// Gateway JWT validation authenticates users; it does not authorize broadcasts.
export function createInternalHandler(
  send: () => Promise<Response>,
  getSecret: () => string | undefined,
) {
  const reply = (error: string, status: number) => new Response(JSON.stringify({ error }), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return reply('Method not allowed', 405);
    const secret = getSecret();
    if (!secret) return reply('Notifications unavailable', 503);
    const actual = req.headers.get('authorization') || '';
    const expected = `Bearer ${secret}`;
    let mismatch = actual.length ^ expected.length;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
    }
    if (mismatch !== 0) return reply('Forbidden', 403);
    try { return await send(); }
    catch { return reply('Could not send notifications', 500); }
  };
}
