import { supabase } from '../lib/supabase'
import type { Opportunity } from './types'
import { subscribeWhileVisible } from './visibleRealtime'

// live-signal-service.py batches opportunities writes into one broadcast
// message per ~5s window (BROADCAST_INTERVAL_SECONDS) instead of every
// write firing its own postgres_changes event — see the 2026-09
// Realtime-quota investigation: ~1,400 tracked markets ticking individually
// blew through the message quota despite barely any real users, and three
// separate frontend subscriptions to the same table tripled it further.
// (ticker was originally batched the same way too, but its volume was
// never actually the problem — it's back on plain postgres_changes, see
// SignalsDemo.tsx.) This opens exactly one channel, shared across every
// caller (Terminal/SignalsDemo), instead of one per component.
function makeBatchTopic<T>(topic: string, event: string) {
  let stop: (() => void) | null = null
  const listeners = new Set<(rows: T[]) => void>()
  const refreshers = new Map<(rows: T[]) => void, () => void>()

  function ensureChannel() {
    if (stop) return
    stop = subscribeWhileVisible(() => supabase
      .channel(topic)
      .on('broadcast', { event }, (msg: { payload?: { rows?: T[] } }) => {
        const rows = msg.payload?.rows ?? []
        for (const cb of listeners) cb(rows)
      }), () => {
        for (const refresh of refreshers.values()) refresh()
      })
  }

  return function subscribe(cb: (rows: T[]) => void, refresh: () => void): () => void {
    listeners.add(cb)
    refreshers.set(cb, refresh)
    ensureChannel()
    return () => {
      listeners.delete(cb)
      refreshers.delete(cb)
      if (listeners.size === 0 && stop) {
        stop()
        stop = null
      }
    }
  }
}

export const onOpportunitiesBatch = makeBatchTopic<Opportunity>('opportunities-batch', 'update')

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
