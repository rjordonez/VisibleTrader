import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath, terminalPath } from '../lib/domains'
import { traderLabel, avatarGradient, avatarInitial, categoryIcon, fmtAbbrev } from './helpers'

interface TraderResult {
  wallet: string
  wallet_name: string | null
  net_profit: number
  deployed: number
}

interface MarketResult {
  condition_id: string
  outcome: string
  title: string
  category: string | null
  cumulative_usd: number
}

// Compact trigger in the header (matches the reference design's collapsed
// state) that opens a full-screen search modal on click — the modal owns
// the real <input>, not this button, same as the reference. Default state
// (empty query) shows real "Top Traders"/"Trending Markets" suggestions
// instead of nothing, so the modal never opens onto a blank screen.
export default function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [topTraders, setTopTraders] = useState<TraderResult[]>([])
  const [trendingMarkets, setTrendingMarkets] = useState<MarketResult[]>([])
  const [traderResults, setTraderResults] = useState<TraderResult[]>([])
  const [marketResults, setMarketResults] = useState<MarketResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetched once when the modal opens, not on every keystroke — this is
  // the default/empty-query state, shown until the user actually types
  // something.
  useEffect(() => {
    if (!open) return
    Promise.resolve(supabase.from('leaderboard').select('wallet, wallet_name, net_profit, deployed').order('net_profit', { ascending: false }).limit(4))
      .then(({ data }) => setTopTraders((data ?? []) as TraderResult[]))
      .catch(() => {})
    Promise.resolve(supabase.from('opportunities_live').select('condition_id, outcome, title, category, cumulative_usd').order('cumulative_usd', { ascending: false }).limit(6))
      .then(({ data }) => setTrendingMarkets((data ?? []) as MarketResult[]))
      .catch(() => {})
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Debounced real search against the same tables, once there's an actual
  // query — separate from the "suggestions" fetch above.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setTraderResults([])
      setMarketResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      Promise.all([
        supabase.from('leaderboard').select('wallet, wallet_name, net_profit, deployed')
          .or(`wallet.ilike.%${q}%,wallet_name.ilike.%${q}%`)
          .order('net_profit', { ascending: false }).limit(8),
        supabase.from('opportunities_live').select('condition_id, outcome, title, category, cumulative_usd')
          .ilike('title', `%${q}%`)
          .order('cumulative_usd', { ascending: false }).limit(8),
      ])
        .then(([tRes, mRes]) => {
          setTraderResults((tRes.data ?? []) as TraderResult[])
          setMarketResults((mRes.data ?? []) as MarketResult[])
        })
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const goToTrader = (wallet: string) => {
    close()
    navigate(dashboardPath(`/trader/${wallet}`))
  }

  const goToMarket = (m: MarketResult) => {
    close()
    navigate(terminalPath(`/market/${encodeURIComponent(m.condition_id)}/${encodeURIComponent(m.outcome)}`))
  }

  const isSearching = query.trim().length > 0
  const traders = isSearching ? traderResults : topTraders
  const markets = isSearching ? marketResults : trendingMarkets

  return (
    <>
      <button type="button" className="gsearch-trigger" onClick={() => setOpen(true)}>
        <Search size={15} />
        <span>Search Traders or Markets</span>
      </button>

      {open && (
        <div className="gsearch-backdrop" onClick={close}>
          <div className="gsearch-panel" onClick={e => e.stopPropagation()}>
            <div className="gsearch-input-row">
              <Search size={18} className="gsearch-input-icon" />
              <input
                ref={inputRef}
                className="gsearch-input"
                placeholder="Search Traders or Markets"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && close()}
              />
              <button type="button" className="gsearch-close" onClick={close} aria-label="Close search">
                <X size={18} />
              </button>
            </div>

            <div className="gsearch-body">
              <div className="gsearch-section-label">{isSearching ? 'Traders' : 'Top Traders'}</div>
              {traders.length === 0 ? (
                <div className="gsearch-empty">{searching ? 'Searching…' : 'No traders found.'}</div>
              ) : (
                <div className="gsearch-trader-grid">
                  {traders.map(t => {
                    const roi = t.deployed > 0 ? (t.net_profit / t.deployed) * 100 : 0
                    return (
                      <button type="button" key={t.wallet} className="gsearch-trader-card" onClick={() => goToTrader(t.wallet)}>
                        <div className="gsearch-trader-avatar" style={{ background: avatarGradient(t.wallet) }}>
                          {avatarInitial(t.wallet, t.wallet_name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="gsearch-trader-name">{traderLabel(t.wallet, t.wallet_name)}</div>
                          <div className={`gsearch-trader-pct ${roi >= 0 ? 'g' : 'r'}`}>
                            {roi >= 0 ? '▲' : '▼'} {Math.abs(roi).toFixed(1)}%
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="gsearch-section-label">{isSearching ? 'Markets' : 'Trending Markets'}</div>
              {markets.length === 0 ? (
                <div className="gsearch-empty">{searching ? 'Searching…' : 'No markets found.'}</div>
              ) : (
                <div className="gsearch-market-list">
                  {markets.map(m => {
                    const ic = categoryIcon(m.category)
                    return (
                      <button type="button" key={`${m.condition_id}::${m.outcome}`} className="gsearch-market-row" onClick={() => goToMarket(m)}>
                        <div className="gsearch-market-icon" style={{ background: ic.bg }}>{ic.emoji}</div>
                        <div className="gsearch-market-title">
                          {m.title} <span className="sig-out">— {m.outcome}</span>
                        </div>
                        <div className="gsearch-market-usd">{fmtAbbrev(m.cumulative_usd)}</div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
