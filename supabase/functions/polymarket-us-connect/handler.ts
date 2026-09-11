import { createClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { validateCredentialInput } from './domain.ts';
import { kmsDecrypt, kmsEncrypt } from './proxy.ts';
import { USApiError, fetchActivity, fetchPositions, verifyCredentials } from './us.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const fields = 'key_id, status, last_verified_at, last_synced_at, connected_at';
class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function logEvent(db: ReturnType<typeof createClient>, userId: string, event: string) {
  await db.from('polymarket_us_connection_events').insert({ user_id: userId, event });
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

    if (body.action === 'connect') {
      let credentials;
      try { credentials = validateCredentialInput(body); }
      catch (e) { throw new RequestError((e as Error).message); }
      try {
        await verifyCredentials(credentials.keyId, credentials.secretKey);
      } catch (e) {
        await logEvent(db, user.id, 'verify_failed');
        throw e instanceof USApiError ? new RequestError(e.message, 502) : e;
      }
      const { ciphertext, keyVersion } = await kmsEncrypt(credentials.secretKey);
      const { data: existing } = await db.from('polymarket_us_connections').select('user_id').eq('user_id', user.id).maybeSingle();
      const { data, error } = await db.from('polymarket_us_connections').upsert({
        user_id: user.id, key_id: credentials.keyId, ciphertext, kms_key_version: keyVersion,
        status: 'active', last_verified_at: new Date().toISOString(), connected_at: new Date().toISOString(),
      }).select(fields).single();
      if (error) throw error;
      await logEvent(db, user.id, existing ? 'replaced' : 'connected');
      return reply({ connection: data });
    }
    if (body.action === 'disconnect') {
      const { error } = await db.from('polymarket_us_connections').delete().eq('user_id', user.id);
      if (error) throw error;
      await logEvent(db, user.id, 'disconnected');
      return reply({ disconnected: true });
    }
    if (body.action === 'snapshot') {
      const { data: connection, error } = await db.from('polymarket_us_connections').select('*').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!connection) return reply({ connection: null });
      let secretKey: string;
      try {
        secretKey = await kmsDecrypt(connection.ciphertext);
      } catch {
        throw new RequestError('Could not restore your connection. Please reconnect.', 502);
      }
      let positions, activity;
      try {
        [positions, activity] = await Promise.all([
          fetchPositions(connection.key_id, secretKey),
          fetchActivity(connection.key_id, secretKey),
        ]);
      } catch (e) {
        if (e instanceof USApiError && /rejected these credentials/.test(e.message)) {
          await db.from('polymarket_us_connections').update({ status: 'needs_reconnect' }).eq('user_id', user.id);
        }
        throw e instanceof USApiError ? new RequestError(e.message, 502) : e;
      }
      await db.from('polymarket_us_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', user.id);
      const { data: publicConnection } = await db.from('polymarket_us_connections').select(fields).eq('user_id', user.id).single();
      return reply({
        connection: publicConnection, fetched_at: new Date().toISOString(),
        positions_limited: positions.length === 100, positions, activity,
      });
    }
    throw new RequestError('Unknown connection action.');
  } catch (e) {
    // Never return upstream bodies, SQL details, auth headers, or credentials.
    return reply({ error: e instanceof RequestError ? e.message : 'Could not complete the connection request. Please try again.' }, e instanceof RequestError ? e.status : 500);
  }
}
