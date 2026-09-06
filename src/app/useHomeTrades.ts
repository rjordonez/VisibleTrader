import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { onTabVisible } from './helpers'
import type { TickerTrade } from './types'

export interface TraderRecord {
  wallet: string
  wallet_name: string | null
  won: number
  lost: number
  net_profit: number
}
interface FeedState {
  key: string
  trades: TickerTrade[]
  records: Map<string, TraderRecord>
  error: boolean
  loading: boolean
}

export function useHomeTrades(tab: 'following' | 'discover', wallets: string[]) {
  const walletKey = JSON.stringify(tab === 'following' ? [...new Set(wallets.map(w => w.toLowerCase()))].sort() : [])
  const key = `${tab}:${walletKey}`
  const [state, setState] = useState<FeedState>({ key: '', trades: [], records: new Map(), error: false, loading: true })
  useEffect(() => {
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const watched = JSON.parse(walletKey) as string[]
        if (tab === 'following' && watched.length === 0) {
          if (!cancelled) setState({ key, trades: [], records: new Map(), error: false, loading: false })
          return
        }
        // Filter wallets before fetching trades, rather than filtering a small
        // global ticker window that could omit every followed wallet.
        const recordsQuery = supabase.from('leaderboard').select('wallet,wallet_name,won,lost,net_profit')
        const recordResult = await (tab === 'discover'
          ? recordsQuery.gt('net_profit', 0).order('net_profit', { ascending: false }).order('wallet').limit(100)
          : recordsQuery.in('wallet', watched))
        if (recordResult.error) throw recordResult.error
        const records = (recordResult.data ?? []) as TraderRecord[]
        const addresses = tab === 'discover' ? records.map(r => r.wallet) : watched
        const tradeResult = addresses.length === 0 ? { data: [], error: null }
          : await supabase.from('ticker').select('*').in('wallet', addresses)
            .order('epoch', { ascending: false }).order('id', { ascending: false }).limit(30)
        if (tradeResult.error) throw tradeResult.error
        if (!cancelled) setState({ key, trades: (tradeResult.data ?? []) as TickerTrade[], records: new Map(records.map(r => [r.wallet.toLowerCase(), r])), loading: false, error: false })
      } catch {
        if (!cancelled) setState(previous => previous.key === key
          ? { ...previous, loading: false, error: true }
          : { key, trades: [], records: new Map(), loading: false, error: true })
      } finally { pending = false }
    }
    void load()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30000)
    const unsubscribe = onTabVisible(() => { void load() })
    return () => { cancelled = true; clearInterval(interval); unsubscribe() }
  }, [key, tab, walletKey])
  return state.key === key ? state : { key, trades: [], records: new Map<string, TraderRecord>(), loading: true, error: false }
}
