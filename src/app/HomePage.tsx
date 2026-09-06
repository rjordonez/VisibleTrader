import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowUpRight, Bell, X, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { dashboardPath } from '../lib/domains'
import { avatarGradient, avatarInitial, categoryIcon, fmtFull, fmtSigned, marketUrl, timeAgo, traderLabel } from './helpers'
import AlertsPage from './AlertsPage'
import type { useAlerts } from './useAlerts'
import { useHomeTrades } from './useHomeTrades'
import './home.css'

function HomePage({ user, alerts }: { user: User | null; alerts: ReturnType<typeof useAlerts> }) {
  // Discovery is the landing experience: a new or returning user should
  // immediately see validated trader activity before opting into Following.
  const [tab, setTab] = useState<'following' | 'discover'>('discover')
  const feed = useHomeTrades(tab, alerts.watchedWallets.map(w => w.wallet))
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Your account'
  return (
    <div className="sig-page home-page">
      <header className="home-account">
        <Link className="home-account-link" to={dashboardPath('/settings')} aria-label={`${displayName}, account settings`}>
          <span className="home-account-avatar">{String(displayName).slice(0, 1).toUpperCase()}</span>
          <span><small>Your home</small><strong>{displayName}</strong></span>
        </Link>
      </header>

      <details className="home-preferences">
        <summary><Bell size={16} /><span>Alerts & following</span><span className="home-alert-count">{alerts.history.length}</span></summary>
        <AlertsPage {...alerts} />
      </details>

      <div className="home-feed-tabs" aria-label="Choose trade feed">
        <button type="button" aria-pressed={tab === 'discover'} className={tab === 'discover' ? 'active' : undefined} onClick={() => setTab('discover')}>Discover</button>
        <button type="button" aria-pressed={tab === 'following'} className={tab === 'following' ? 'active' : undefined} onClick={() => setTab('following')}>Following <span>{alerts.watchedWallets.length}</span></button>
      </div>
      <p className="home-feed-description">{tab === 'discover' ? 'Recent trades from the top 100 profitable tracked traders.' : 'The latest moves from wallets you follow.'}</p>
      {feed.error && <p className="home-feed-message" role="status">Unable to refresh trades. {feed.trades.length > 0 ? 'Showing the last available activity. ' : ''}Retrying automatically.</p>}
      <section aria-label={tab === 'following' ? 'Following trades' : 'Discover trades'} aria-busy={feed.loading}>
        {feed.loading ? <div aria-label="Loading trades">{[0, 1, 2].map(i => <div key={i} className="home-trade-skeleton sig-skel" aria-hidden="true" />)}</div> : !feed.error && feed.trades.length === 0 ? (
          <div className="home-feed-empty"><h2>{tab === 'following' && alerts.watchedWallets.length === 0 ? 'Who are you watching?' : 'No recent trades here yet.'}</h2><p>{tab === 'following' ? 'Find a trader in Discover and follow them to bring their next trades here.' : 'Trades from profitable tracked wallets will appear here when available.'}</p>{tab === 'following' && <button type="button" onClick={() => setTab('discover')}>Discover traders <ArrowUpRight size={16} /></button>}</div>
        ) : feed.trades.map(trade => {
          const wallet = trade.wallet!
          const record = feed.records.get(wallet.toLowerCase())
          const name = traderLabel(wallet, trade.wallet_name || record?.wallet_name || null)
          const watched = alerts.watchedWallets.find(w => w.wallet.toLowerCase() === wallet.toLowerCase())
          const resolved = record ? record.won + record.lost : 0
          const winRate = record && resolved > 0 ? record.won / resolved * 100 : null
          const url = marketUrl(trade.slug)
          const category = categoryIcon(trade.category)
          return (
            <article className="home-trade" key={trade.id}>
              <div className="home-trade-top">
                <Link className="home-trader" to={dashboardPath(`/trader/${wallet}`)}>
                  <span className="home-trader-avatar" style={{ background: avatarGradient(wallet) }}>{avatarInitial(wallet, name)}</span>
                  <span><strong>{name}</strong><time dateTime={trade.ts}>{timeAgo(trade.ts)}</time></span>
                </Link>
                <button className={`home-follow-button ${watched ? 'is-following' : ''}`} type="button" aria-pressed={!!watched} aria-label={`${watched ? 'Unfollow' : 'Follow'} ${name}`} onClick={() => watched ? alerts.removeWallet(watched.wallet) : alerts.addWallet(wallet)}>{watched ? <X size={15} /> : <Plus size={15} />}{watched ? 'Unfollow' : 'Follow'}</button>
              </div>
              {record ? <>
                <div className="home-track-record">
                  <strong className={record.net_profit >= 0 ? 'positive' : 'negative'}>{fmtSigned(record.net_profit)}</strong>
                  <span>resolved P&L</span>
                  <span className="home-win-rate" title="Winning resolved positions divided by all winning and losing resolved positions. Unresolved positions are excluded.">
                    {winRate === null ? 'Win rate unavailable' : `${Math.round(winRate)}% win rate`}
                  </span>
                </div>
                <p className="home-record-context">{record.won} wins / {resolved} resolved positions · All tracked history</p>
              </> : <p className="home-record-context home-record-missing">No resolved performance available yet.</p>}
              <div className="home-trade-action"><span className={trade.side === 'BUY' ? 'positive' : 'negative'}>{trade.side === 'BUY' ? 'Bought' : 'Sold'}</span> <strong>{fmtFull(trade.usd)}</strong> <span>of {trade.outcome}</span></div>
              <div className="home-trade-market">
                <span className="home-market-icon" style={{ background: category.bg }} aria-hidden="true">{category.emoji}</span>
                <div>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{trade.title}<ArrowUpRight size={15} /></a> : <p>{trade.title}</p>}<span>{Math.round(trade.price * 100)}¢ {trade.side === 'BUY' ? 'entry' : 'sale price'}</span></div>
              </div>
            </article>
          )
        })}
      </section>
      {!feed.loading && feed.trades.length > 0 && <p className="home-feed-footer">Latest {feed.trades.length} trades · Updates every 30 seconds</p>}
    </div>
  )
}

export default HomePage
