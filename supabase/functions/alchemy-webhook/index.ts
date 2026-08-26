// Receives Alchemy's Custom Webhook POST for Polymarket's Neg Risk CTF
// Exchange's OrderFilled event and queues each decoded fill into
// onchain_fills for scripts/live-signal-service.py to pick up — replaces
// the old last_trade_price WebSocket path as the source of trade discovery
// (see the 2026-08-26 investigation: that path measured a 60% miss rate on
// rapid trade bursts even on actively-watched markets). Deliberately thin —
// decode and insert only, no business logic — so it's cheap and safe for
// Alchemy to retry on any transient failure.
//
// Payload shape confirmed live against a real webhook.site capture on
// 2026-08-26 (Alchemy's GraphQL Custom Webhook format):
//   { webhookId, id, createdAt, type: "GRAPHQL",
//     event: { data: { block: { timestamp, logs: [{ data, topics, index,
//       transaction: { hash } }, ...] } }, sequenceNumber, network } }
// Logs are delivered as raw hex — Alchemy does NOT pre-decode event data for
// this webhook type, confirmed by inspecting the real payload rather than
// assuming.
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Same topic hash as ORDER_FILLED_TOPIC in scripts/live-signal-service.py —
// verified live against PolygonScan's decoded ABI for Polymarket's Neg Risk
// CTF Exchange V2 (0xe2222d279d744050d28e00520010520000310f59).
const ORDER_FILLED_TOPIC = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'

async function verifyAlchemySignature(payload: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expected = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  if (expected.length !== sigHeader.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ sigHeader.charCodeAt(i)
  return mismatch === 0
}

interface AlchemyLog {
  data: string
  topics: string[]
  index: number
  transaction: { hash: string }
}

// Mirrors _decode_order_filled in scripts/live-signal-service.py, extended
// to also read makerAmountFilled/takerAmountFilled (words[2]/words[3]) —
// the WS-fed path never needed those since it got price/size directly from
// Polymarket's own last_trade_price event; this path has to derive them
// itself since raw on-chain data is all we get.
function decodeOrderFilled(log: AlchemyLog) {
  if (log.topics.length !== 4 || log.topics[0] !== ORDER_FILLED_TOPIC) return null
  const maker = '0x' + log.topics[2].slice(-40)
  const taker = '0x' + log.topics[3].slice(-40)
  const data = log.data.slice(2)
  const words: string[] = []
  for (let i = 0; i < data.length; i += 64) words.push(data.slice(i, i + 64))
  if (words.length < 4) return null
  const side = parseInt(words[0], 16)
  const tokenId = BigInt('0x' + words[1]).toString()
  const makerAmountFilled = BigInt('0x' + words[2]).toString()
  const takerAmountFilled = BigInt('0x' + words[3]).toString()
  return {
    maker: maker.toLowerCase(),
    taker: taker.toLowerCase(),
    side,
    tokenId,
    makerAmountFilled,
    takerAmountFilled,
  }
}

Deno.serve(async (req) => {
  const payload = await req.text()
  const valid = await verifyAlchemySignature(payload, req.headers.get('X-Alchemy-Signature'), Deno.env.get('ALCHEMY_WEBHOOK_SIGNING_KEY')!)
  if (!valid) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 400 })
  }

  const body = JSON.parse(payload)
  const block = body.event?.data?.block
  const logs: AlchemyLog[] = block?.logs ?? []
  if (!block || logs.length === 0) {
    // Fires on every new block whether or not it has a matching log —
    // an empty block is a normal, expected no-op, not an error.
    return new Response(JSON.stringify({ received: true, inserted: 0 }))
  }

  const blockTimestamp = new Date(block.timestamp * 1000).toISOString()
  const rows = logs
    .map(log => {
      const decoded = decodeOrderFilled(log)
      if (!decoded) return null
      return {
        tx_hash: log.transaction.hash,
        log_index: log.index,
        maker: decoded.maker,
        taker: decoded.taker,
        side: decoded.side,
        token_id: decoded.tokenId,
        maker_amount_filled: decoded.makerAmountFilled,
        taker_amount_filled: decoded.takerAmountFilled,
        block_timestamp: blockTimestamp,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (rows.length === 0) {
    return new Response(JSON.stringify({ received: true, inserted: 0 }))
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ignoreDuplicates handles Alchemy's at-least-once redelivery — a log
    // we've already queued (same tx_hash + log_index) just no-ops.
    const { error } = await supabase.from('onchain_fills').upsert(rows, {
      onConflict: 'tx_hash,log_index',
      ignoreDuplicates: true,
    })
    if (error) throw error
  } catch (err) {
    // Non-2xx makes Alchemy retry with backoff — a transient DB hiccup
    // should be retried, not silently dropped as "this block was handled".
    console.error('alchemy-webhook handler error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true, inserted: rows.length }), {
    headers: { 'content-type': 'application/json' },
  })
})
