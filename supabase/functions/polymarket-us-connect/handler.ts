import { createClient } from 'jsr:@supabase/supabase-js@2.116.0';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { validateCredentialInput } from './domain.ts';
import { kmsDecrypt, kmsEncrypt } from './proxy.ts';
import { USApiError, fetchActivityPage, fetchPortfolio, verifyCredentials } from './us.ts';

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const fields = 'key_id, status, last_verified_at, last_synced_at, connected_at, backfill_status';
class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function logEvent(db: SupabaseClient, userId: string, event: string) {
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
    if (body.action === 'backfill') {
      const { data: connection, error } = await db.from('polymarket_us_connections').select('*').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!connection) throw new RequestError('Connect a Polymarket US account first.', 404);
      if (connection.backfill_status === 'done') return reply({ done: true, imported: 0 });
      let secretKey: string;
      try {
        secretKey = await kmsDecrypt(connection.ciphertext);
      } catch {
        throw new RequestError('Could not restore your connection. Please reconnect.', 502);
      }
      let cursor: string | null = connection.backfill_status === 'in_progress' ? connection.backfill_cursor : null;
      let imported = 0;
      let done = false;
      try {
        // Bounded to 3 pages per call so one invocation can't run long enough
        // to hit the function's execution limit; the client loops this action
        // until `done` to walk the rest of a large history.
        for (let page = 0; page < 3; page++) {
          const { trades, nextCursor, eof } = await fetchActivityPage(connection.key_id, secretKey, cursor);
          if (trades.length) {
            const { data: inserted, error: insertError } = await db.from('polymarket_trades')
              .upsert(trades.map(t => ({ user_id: user.id, venue: 'us', ...t })), { onConflict: 'user_id,venue,external_id', ignoreDuplicates: true })
              .select('external_id');
            if (insertError) throw insertError;
            imported += inserted?.length ?? 0;
            // Trades come back newest-first and we never skip pages, so a page
            // that contributes zero new rows means we've reached territory an
            // earlier sync already covered — safe to stop without paging further.
            if (!inserted?.length) { done = true; cursor = null; break; }
          }
          if (eof || !nextCursor) { done = true; cursor = null; break; }
          cursor = nextCursor;
        }
      } catch (e) {
        throw e instanceof USApiError ? new RequestError(e.message, 502) : e;
      }
      await db.from('polymarket_us_connections').update({
        backfill_status: done ? 'done' : 'in_progress', backfill_cursor: cursor,
      }).eq('user_id', user.id);
      return reply({ done, imported });
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
      let portfolio;
      try {
        portfolio = await fetchPortfolio(connection.key_id, secretKey);
      } catch (e) {
        if (e instanceof USApiError && (e.status === 401 || e.status === 403)) {
          await db.from('polymarket_us_connections').update({ status: 'needs_reconnect' }).eq('user_id', user.id);
        }
        throw e instanceof USApiError ? new RequestError(e.message, 502) : e;
      }
      if (Object.keys(portfolio.resource_errors).length === 0) {
        await db.from('polymarket_us_connections').update({ last_synced_at: new Date().toISOString() }).eq('user_id', user.id);
      }
      const { data: publicConnection } = await db.from('polymarket_us_connections').select(fields).eq('user_id', user.id).single();
      return reply({
        connection: publicConnection, fetched_at: new Date().toISOString(),
        ...portfolio,
      });
    }
    throw new RequestError('Unknown connection action.');
  } catch (e) {
    // Never return upstream bodies, SQL details, auth headers, or credentials.
    return reply({ error: e instanceof RequestError ? e.message : 'Could not complete the connection request. Please try again.' }, e instanceof RequestError ? e.status : 500);
  }
}
