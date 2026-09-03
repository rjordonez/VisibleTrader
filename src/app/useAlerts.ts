import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import type { Opportunity, TickerTrade } from './types'
import { onTabVisible, PAGE_SIZE, traderLabel, fmtFull, WATCHED_WALLETS_KEY } from './helpers'

export interface WalletWatch { wallet: string }
export interface AlertEvent { id: string; text: string; ts: number }

const WATCHED_TIER_KEY = 'visibletrader_watched_tier'

// Was owned by AlertsPage itself, so alert history/polling only existed
// while that one page was mounted — moved up here so it runs continuously
// wherever the user is in the app (needed for the header bell to show a
// live count/preview regardless of the active tab), with AlertsPage.tsx
// now just a view onto this same shared state instead of its own copy.
export function useAlerts() {
  const [watchedWallets, setWatchedWallets] = useState<WalletWatch[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [minTier, setMinTier] = useState<number>(() => {
    const raw = localStorage.getItem(WATCHED_TIER_KEY)
    return raw ? Number(raw) : 5000
  })
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  )
  const [history, setHistory] = useState<AlertEvent[]>([])
  const seenTicker = useRef<Set<number>>(new Set())
  const seenTier = useRef<Set<string>>(new Set())

  useEffect(() => { localStorage.setItem(WATCHED_WALLETS_KEY, JSON.stringify(watchedWallets)) }, [watchedWallets])
  useEffect(() => { localStorage.setItem(WATCHED_TIER_KEY, String(minTier)) }, [minTier])

  const fire = useCallback((text: string) => {
    setHistory(h => [{ id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() }, ...h].slice(0, 50))
    if (permission === 'granted' && 'Notification' in window) {
      new Notification('VisibleTrader Signals', { body: text })
    }
  }, [permission])

  useEffect(() => {
    if (watchedWallets.length === 0) return
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('ticker').select('*').order('epoch', { ascending: false }).limit(200))
        .then(({ data }) => {
          if (cancelled) return
          for (const t of (data ?? []) as TickerTrade[]) {
            if (!t.wallet || seenTicker.current.has(t.id)) continue
            const watched = watchedWallets.find(w => w.wallet.toLowerCase() === t.wallet!.toLowerCase())
            if (!watched) continue
            seenTicker.current.add(t.id)
            fire(`${traderLabel(t.wallet, t.wallet_name)} ${t.side === 'BUY' ? 'bought' : 'sold'} ${fmtFull(t.usd)} — ${t.title}`)
          }
        })
        .catch(() => {})
    }
    load()
    // 60s, not 15s — this now runs continuously app-wide (moved up from
    // AlertsPage, see the file header comment) instead of only while that
    // one page was open, so the old cadence meant far more frequent checks
    // than before, not fewer — reported live as alerts feeling like they
    // fire constantly.
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [watchedWallets, permission, fire])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('opportunities_live').select('*')
        .order('last_updated', { ascending: false }).order('id', { ascending: false })
        .limit(PAGE_SIZE))
        .then(({ data }) => {
          if (cancelled) return
          for (const o of (data ?? []) as Opportunity[]) {
            if (o.tier < minTier) continue
            const key = `${o.condition_id}::${o.outcome}::${o.tier}`
            if (seenTier.current.has(key)) continue
            seenTier.current.add(key)
            fire(`Tier crossed: ${o.title} — ${o.outcome} hit ${fmtFull(o.tier)}+ (${o.wallet_count} wallets)`)
          }
        })
        .catch(() => {})
    }
    load()
    // Same 60s reasoning as the ticker-alert effect above.
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [minTier, permission, fire])

  const requestPermission = () => {
    if (!('Notification' in window)) return
    Notification.requestPermission().then(p => {
      setPermission(p)
      posthog.capture('notification_permission_updated', { permission: p })
    })
  }

  const addWallet = (addr: string) => {
    const trimmed = addr.trim()
    if (!trimmed) return
    setWatchedWallets(w => (w.some(x => x.wallet.toLowerCase() === trimmed.toLowerCase()) ? w : [...w, { wallet: trimmed }]))
    posthog.capture('alert_watchlist_wallet_added')
  }

  const removeWallet = (wallet: string) => {
    setWatchedWallets(w => w.filter(x => x.wallet !== wallet))
    posthog.capture('alert_watchlist_wallet_removed')
  }

  return { watchedWallets, minTier, setMinTier, permission, requestPermission, history, addWallet, removeWallet }
}
