import { supabase } from '../../lib/supabase'

export interface Connection {
  wallet_address: string
  signer_address: string | null
  display_name: string
  verified_at: string | null
  connected_at: string
}
export interface Profile { wallet_address: string; display_name: string }
export interface Position {
  asset: string; title: string; outcome: string; size: number | null
  current_value: number | null; cash_pnl: number | null; redeemable: boolean
}
export interface Activity {
  transaction_hash: string; asset: string; timestamp: number | null
  title: string; outcome: string; side: string; amount: number | null
  size: number | null; price: number | null
  pnl?: number | null
}
export interface Snapshot {
  connection: Connection | null
  positions?: Position[]
  activity?: Activity[]
  positions_limited?: boolean
  activity_limited?: boolean
  fetched_at?: string
}
export interface USConnection {
  key_id: string
  status: 'active' | 'needs_reconnect' | 'revoked'
  last_verified_at: string | null
  last_synced_at: string | null
  connected_at: string
  backfill_status?: 'pending' | 'in_progress' | 'done'
}
export interface USSnapshot {
  resource_errors?: { positions?: string; activity?: string }
  activity_limited?: boolean
  connection: USConnection | null
  positions?: Position[]
  activity?: Activity[]
  positions_limited?: boolean
  fetched_at?: string
}

export async function connectionRequest<T>(body: Record<string, unknown>, signal?: AbortSignal, fn: 'polymarket-connect' | 'polymarket-us-connect' = 'polymarket-connect'): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body, signal })
  if (error) {
    let message = 'Could not reach account connections. Please try again.'
    if (error.context instanceof Response) {
      try {
        const payload = await error.context.json()
        if (typeof payload?.error === 'string') message = payload.error
      } catch { /* A gateway error is not a JSON application error. */ }
    }
    throw new Error(message)
  }
  if (!data || data.error) throw new Error(data?.error || 'Unexpected connection response. Please retry.')
  return data as T
}

export async function loadConnection() {
  const { data, error } = await supabase.from('polymarket_connections')
    .select('wallet_address, signer_address, display_name, verified_at, connected_at').maybeSingle()
  if (error) throw new Error('Account connections are unavailable. Please retry in a moment.')
  return data as Connection | null
}

export async function loadUSConnection() {
  const { data, error } = await supabase.from('polymarket_us_connections')
    .select('key_id, status, last_verified_at, last_synced_at, connected_at, backfill_status').maybeSingle()
  if (error) throw new Error('Account connections are unavailable. Please retry in a moment.')
  return data as USConnection | null
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
export const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
