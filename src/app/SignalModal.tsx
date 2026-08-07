import { useEffect, useState } from 'react'
import type { Opportunity, WalletContribution, ChartPoint } from './types'
import {
  fetchWallets, fetchChart, categoryIcon, signalsTag, signalsTraderStatus,
  walletReturn, fmtFull, fmtSigned, profileUrl, traderLabel, timeAgo,
} from './helpers'
import { PriceChart } from './PriceChart'
import { SkelBlock, SkelDrillRows } from './Skeleton'

export function SignalModal({ opportunity: o, onClose }: { opportunity: Opportunity; onClose: () => void }) {
  const [wallets, setWallets] = useState<WalletContribution[]>([])
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(true)

  useEffect(() => {
    fetchWallets(o.condition_id, o.outcome).then(setWallets).finally(() => setWalletsLoading(false))
    fetchChart(o.condition_id, o.outcome).then(setChartHistory).finally(() => setChartLoading(false))
  }, [o.condition_id, o.outcome])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const ic = categoryIcon(o.category)
  const tag = signalsTag(o.tier, o.cumulative_usd)

  return (
    <div className="sig-modal-backdrop" onClick={onClose}>
      <div className="sig-modal-wrap" onClick={e => e.stopPropagation()}>
        <button className="sig-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sig-modal">
        <div className="sig-hero-top">
          <div className="sig-card-icon" style={{ background: ic.bg, width: 44, height: 44, fontSize: 20 }}>{ic.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sig-hero-q">{o.title} <span className="sig-out">— {o.outcome}</span></div>
            <div className="sig-card-meta">
              {o.wallet_count} top trader{o.wallet_count > 1 ? 's' : ''} · <span className={`sig-tag ${tag.cls}`} style={{ marginTop: 0 }}>{tag.label}</span>
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: o.total_profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
            {fmtSigned(o.total_profit)}
          </div>
        </div>

        <div className="sig-stats-row" style={{ margin: '16px 0' }}>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Price</div>
            <div className="sig-stat-cell-val">{Math.round(o.latest_price * 100)}¢</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Total Deployed</div>
            <div className="sig-stat-cell-val g">{fmtFull(o.cumulative_usd)}</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Traders</div>
            <div className="sig-stat-cell-val">{o.wallet_count}</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Total Profit</div>
            <div className={`sig-stat-cell-val ${o.total_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(o.total_profit)}</div>
          </div>
        </div>

        <div className="sig-drill-label">Price history — dots mark each trader's buy-in</div>
        <div style={{ minHeight: 220, marginBottom: 16 }}>
          {chartLoading && <SkelBlock height={220} />}
          {!chartLoading && chartHistory.length < 2 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No price history available for this market.</div>
          )}
          {!chartLoading && chartHistory.length >= 2 && (
            <PriceChart history={chartHistory} wallets={wallets} />
          )}
        </div>

        <div className="sig-drill-label">Contributing traders</div>
        <div style={{ minHeight: 5 * 36 }}>
          {walletsLoading && <SkelDrillRows count={5} />}
          {!walletsLoading && wallets.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No contributor detail available.</div>
          )}
          {!walletsLoading && wallets.map((w, i) => {
            const st = signalsTraderStatus(w)
            const ret = walletReturn(w, o.latest_price)
            return (
              <div key={i} className="sig-drill-row">
                <a href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer" className="sig-drill-name">
                  {traderLabel(w.wallet, w.wallet_name)}
                </a>
                <div className="sig-drill-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}¢ · {timeAgo(w.ts)}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: ret.profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
                  {fmtSigned(ret.profit)}{!ret.realized ? ' (unrealized)' : ''}
                </div>
                <div className="sig-drill-status" style={{ color: st.color, background: st.color + '26' }}>{st.label}</div>
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </div>
  )
}
