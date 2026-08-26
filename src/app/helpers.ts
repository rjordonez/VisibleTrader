import { supabase } from '../lib/supabase'
import type { Opportunity, WalletContribution, ChartPoint } from './types'

// AlertsPage.tsx's per-browser (not tracked_wallets — that's a shared,
// app-wide roster, see its own table comment) personal watchlist. Exported
// here rather than defined in AlertsPage.tsx so other pages (SearchPage's
// Track button) can add to it directly without importing a whole page
// component for one constant.
export const WATCHED_WALLETS_KEY = 'visibletrader_watched_wallets'

export function addToWatchedWallets(wallet: string) {
  try {
    const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
    const watched = raw ? (JSON.parse(raw) as { wallet: string }[]) : []
    if (watched.some(w => w.wallet.toLowerCase() === wallet.toLowerCase())) return
    localStorage.setItem(WATCHED_WALLETS_KEY, JSON.stringify([...watched, { wallet }]))
  } catch { /* localStorage unavailable or corrupted — tracking itself still succeeded */ }
}

export function removeFromWatchedWallets(wallet: string) {
  try {
    const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
    if (!raw) return
    const watched = (JSON.parse(raw) as { wallet: string }[]).filter(w => w.wallet.toLowerCase() !== wallet.toLowerCase())
    localStorage.setItem(WATCHED_WALLETS_KEY, JSON.stringify(watched))
  } catch { /* localStorage unavailable or corrupted — untracking itself still succeeded */ }
}

export function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// Polymarket username when we have one (from the leaderboard scrape), else a
// shortened wallet address, else "someone" if we haven't resolved it yet.
export function traderLabel(wallet: string | null, walletName: string | null) {
  // Some backfilled names are the raw wallet address with a synthetic
  // suffix tacked on (e.g. "0x2c3350…a0563-1759935795465") rather than a
  // real username — cap length defensively so a malformed name can't blow
  // out the fixed-width name column regardless of its shape. 24 chars
  // comfortably fits real long usernames (e.g. "ferrariChampions2026").
  if (walletName) return walletName.length > 24 ? `${walletName.slice(0, 22)}…` : walletName
  if (wallet) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
  return 'someone'
}

export function profileUrl(wallet: string | null) {
  return wallet ? `https://polymarket.com/profile/${wallet}` : null
}

// Deterministic per-wallet color so the same trader always gets the same
// avatar instead of a random one flickering between refreshes/re-renders.
const AVATAR_GRADIENTS = [
  ['#1e8f0d', '#56ab4a'],
  ['#2563eb', '#60a5fa'],
  ['#9333ea', '#c084fc'],
  ['#ea580c', '#fb923c'],
  ['#0891b2', '#22d3ee'],
  ['#dc2626', '#f87171'],
  ['#ca8a04', '#facc15'],
  ['#db2777', '#f472b6'],
]
export function avatarGradient(wallet: string | null) {
  if (!wallet) return 'linear-gradient(135deg, #4a5158, #6b7280)'
  let hash = 0
  for (let i = 0; i < wallet.length; i++) hash = (hash * 31 + wallet.charCodeAt(i)) | 0
  const [a, b] = AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

export function avatarInitial(wallet: string | null, walletName: string | null) {
  return traderLabel(wallet, walletName)[0]?.toUpperCase() ?? '?'
}

export function marketUrl(slug: string | null) {
  return slug ? `https://polymarket.com/event/${slug}` : null
}

// opportunities_live has no hard cap on row count as more markets get
// tracked over time, so every fetch site bounds its query instead of
// pulling the entire view — last_updated is written only on a tier
// crossing (a low-churn event), so a page of the most-recent PAGE_SIZE
// covers "what's new" for the Alerts/Home use cases without pagination,
// and the Vetted Picks tab (the one actual browsable list) adds "Load
// more" using a keyset cursor on (last_updated, id) instead of OFFSET,
// since OFFSET pagination degrades as the table grows.
export const PAGE_SIZE = 300

export function opportunityCursor(o: Pick<Opportunity, 'last_updated' | 'id' | 'total_profit'>, sortMode: 'recent' | 'profit') {
  // PostgREST has no clean compound row-value "<" comparison, so this is
  // the standard keyset-pagination workaround: everything strictly past
  // the last row's sort key, plus same-value rows with a smaller id (the
  // id tiebreaker only ever matters on an exact tie in the sort column).
  if (sortMode === 'profit') {
    return `total_profit.lt.${o.total_profit},and(total_profit.eq.${o.total_profit},id.lt.${o.id})`
  }
  return `last_updated.lt.${o.last_updated},and(last_updated.eq.${o.last_updated},id.lt.${o.id})`
}

// Every polling loop in this file is vulnerable to the same thing: browsers
// heavily throttle setInterval in a backgrounded tab (sometimes to once a
// minute or less), and a Realtime channel can go quiet across a long
// suspension without visibly reconnecting. Left alone, a tab backgrounded
// for a while and then refocused shows a frozen feed with no indication
// anything's wrong — confirmed live, "everything says 14-23m ago and
// nothing new arrives" is exactly this, not a backend outage. Call this
// alongside a poll loop's own setInterval so switching back to the tab
// always forces an immediate refetch instead of waiting on the next lucky
// timer tick.
export function onTabVisible(cb: () => void) {
  const handler = () => { if (document.visibilityState === 'visible') cb() }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}

export function byCategory<T extends { category: string | null }>(list: T[], category: string) {
  return category === 'all' ? list : list.filter(x => (x.category ?? 'other') === category)
}

export const fetchWallets = (conditionId: string, outcome: string) =>
  Promise.resolve(
    supabase.from('wallet_positions').select('*')
      .eq('condition_id', conditionId).eq('outcome', outcome)
      .order('ts', { ascending: false })
  ).then(({ data }) => (data ?? []) as WalletContribution[]).catch(() => [] as WalletContribution[])

export const fetchChart = (conditionId: string, outcome: string) =>
  supabase.functions.invoke('price-chart', { body: { condition_id: conditionId, outcome } })
    .then(({ data }) => (data as { history: ChartPoint[] } | null)?.history || [])
    .catch(() => [] as ChartPoint[])

export const CATEGORY_ICON: Record<string, { emoji: string; bg: string }> = {
  politics:  { emoji: '🏛️', bg: 'rgba(47,111,237,0.15)' },
  sports:    { emoji: '⚽', bg: 'rgba(0,209,122,0.15)' },
  esports:   { emoji: '🎮', bg: 'rgba(168,109,255,0.18)' },
  crypto:    { emoji: '₿', bg: 'rgba(247,147,26,0.18)' },
  culture:   { emoji: '🎭', bg: 'rgba(242,183,63,0.15)' },
  mentions:  { emoji: '💬', bg: 'rgba(47,111,237,0.15)' },
  weather:   { emoji: '🌤️', bg: 'rgba(143,151,163,0.15)' },
  economics: { emoji: '📊', bg: 'rgba(0,209,122,0.15)' },
  tech:      { emoji: '✦', bg: 'rgba(168,109,255,0.18)' },
  finance:   { emoji: '💰', bg: 'rgba(242,183,63,0.15)' },
  other:     { emoji: '🔹', bg: 'rgba(143,151,163,0.15)' },
}

export function categoryIcon(category: string | null) {
  return CATEGORY_ICON[category ?? 'other'] ?? CATEGORY_ICON.other
}

export function categoryLabel(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

// Fixed taxonomy (not derived from live data) since the category filter
// renders before any page has fetched its own category counts.
export const NAV_CATEGORIES = ['politics', 'sports', 'crypto', 'esports', 'finance', 'economics', 'tech', 'culture', 'weather', 'mentions']

export function fmtAbbrev(n: number) {
  return n >= 1000 ? '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : '$' + Math.round(n)
}

export function fmtFull(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function fmtSigned(n: number) {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// Same as fmtSigned but abbreviated ("+$382k") — for narrow contexts (a
// sidebar table column) where the full "+$381,743" would force horizontal
// scroll.
export function fmtAbbrevSigned(n: number) {
  const sign = n >= 0 ? '+' : '-'
  const abs = Math.abs(n)
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k` : `${sign}$${Math.round(abs)}`
}

export function signalsTag(tier: number, cumulativeUsd: number) {
  return tier === 0
    ? { cls: 'solo', label: 'SOLO PICK' }
    : { cls: 'big', label: `${fmtAbbrev(cumulativeUsd)} TIER` }
}

export function gaugePct(entries: number, exited: number, closed: number) {
  return entries > 0 ? Math.round(((entries - exited - closed) / entries) * 100) : 100
}

export function gaugeColor(pct: number) {
  return pct >= 80 ? '#00d17a' : pct >= 50 ? '#f2b73f' : '#ff3b5c'
}

export function isToday(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function signalsTraderStatus(w: WalletContribution) {
  if (w.market_closed) return { label: w.resolved_win ? 'Won' : 'Lost', color: w.resolved_win ? '#00d17a' : '#ff3b5c' }
  if (!w.exit_ts) return { label: 'Holding', color: '#00d17a' }
  if (w.is_scalp) return { label: 'Scalped', color: '#2f6fed' }
  return { label: 'Exited', color: '#ff3b5c' }
}

// Realized profit if resolved or exited (uses the actual settlement/exit price);
// unrealized (mark-to-market) if still holding, using the market's current price
// as a stand-in for "what could I get out right now."
export function walletReturn(w: WalletContribution, currentPrice: number): { profit: number; realized: boolean } {
  const shares = w.price > 0 ? w.usd / w.price : 0
  if (w.market_closed) {
    return { profit: w.resolved_win ? shares * 1 - w.usd : -w.usd, realized: true }
  }
  if (w.exit_ts && w.exit_price != null) {
    return { profit: shares * w.exit_price - w.usd, realized: true }
  }
  return { profit: shares * currentPrice - w.usd, realized: false }
}
