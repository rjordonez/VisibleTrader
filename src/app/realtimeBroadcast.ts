import { supabase } from '../lib/supabase'
import type { Opportunity, TickerTrade } from './types'

// live-signal-service.py batches opportunities/ticker writes into one
// broadcast message per ~5s window (BROADCAST_INTERVAL_SECONDS) instead of
// every write firing its own postgres_changes event — see the 2026-09
// Realtime-quota investigation: ~1,400 tracked markets ticking individually
// blew through the message quota despite barely any real users, and three
// separate frontend subscriptions to the same table tripled it further.
// Each topic below opens exactly one channel, shared across every caller
// (HomePage/Terminal/SignalsDemo), instead of one per component.
function makeBatchTopic<T>(topic: string, event: string) {
  let channel: ReturnType<typeof supabase.channel> | null = null
  const listeners = new Set<(rows: T[]) => void>()

  function ensureChannel() {
    if (channel) return
    channel = supabase
      .channel(topic)
      .on('broadcast', { event }, (msg: { payload?: { rows?: T[] } }) => {
        const rows = msg.payload?.rows ?? []
        for (const cb of listeners) cb(rows)
      })
      .subscribe()
  }

  return function subscribe(cb: (rows: T[]) => void): () => void {
    listeners.add(cb)
    ensureChannel()
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0 && channel) {
        supabase.removeChannel(channel)
        channel = null
      }
    }
  }
}

export const onOpportunitiesBatch = makeBatchTopic<Opportunity>('opportunities-batch', 'update')
export const onTickerBatch = makeBatchTopic<TickerTrade>('ticker-batch', 'insert')

export function opportunityKey(o: { condition_id: string; outcome: string }): string {
  return `${o.condition_id}::${o.outcome}`
}

/** Updates in place any rows already present (matched by condition_id+outcome); ignores rows not currently loaded — a
 * genuinely new opportunity still surfaces via the existing 60s fallback poll / tab-visibility refetch, not this path. */
export function mergeOpportunities(current: Opportunity[], updates: Opportunity[]): Opportunity[] {
  if (updates.length === 0) return current
  const byKey = new Map(updates.map(o => [opportunityKey(o), o]))
  if (!current.some(o => byKey.has(opportunityKey(o)))) return current
  return current.map(o => byKey.get(opportunityKey(o)) ?? o)
}
