import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { onTabVisible, fmtSigned, fmtFull, profileUrl, traderLabel, timeAgo } from './helpers'
import { CumulativeChart } from './PriceChart'
import { SkelStatsRow, SkelBlock, SkelTableRows } from './Skeleton'

/* ── Profits ── */
interface ProfitsSummary {
  resolved_n: number
  won: number
  lost: number
  deployed: number
  net_profit: number
}

interface ProfitsDaily {
  d: string
  day_profit: number
}

interface ProfitsPosition {
  wallet: string
  wallet_name: string | null
  title: string
  outcome: string
  usd: number
  price: number
  resolved_win: boolean
  resolved_ts: string
  profit: number
}

// Personal-project placeholder, not real data: swaps the headline stats and
// chart for hand-picked numbers while there are no real users on the
// platform to mislead. This must come out (set DEMO_OVERRIDE to false, or
// delete this block and the two ?? fallbacks below) before this page is
// ever shown to anyone but the owner — never let it touch what's actually
// fetched or stored.
const DEMO_OVERRIDE = false
const demoSummary: ProfitsSummary = { resolved_n: 950, won: 610, lost: 340, deployed: 305650, net_profit: 50283 }
const demoDaily: ProfitsDaily[] = [
  { d: '2026-07-24', day_profit: 1820 }, { d: '2026-07-25', day_profit: 1540 },
  { d: '2026-07-26', day_profit: 2910 }, { d: '2026-07-27', day_profit: 2340 },
  { d: '2026-07-28', day_profit: -680 }, { d: '2026-07-29', day_profit: 3970 },
  { d: '2026-07-30', day_profit: 4360 }, { d: '2026-07-31', day_profit: -710 },
  { d: '2026-08-01', day_profit: 4690 }, { d: '2026-08-02', day_profit: 4080 },
  { d: '2026-08-03', day_profit: 4520 }, { d: '2026-08-04', day_profit: -1690 },
  { d: '2026-08-05', day_profit: 6250 }, { d: '2026-08-06', day_profit: 5080 },
  { d: '2026-08-07', day_profit: 4610 }, { d: '2026-08-08', day_profit: -1780 },
  { d: '2026-08-09', day_profit: 5790 }, { d: '2026-08-10', day_profit: 3183 },
]

// Cleaned up from a real pasted snapshot of closed positions (a couple of
// rows had gotten garbled by a copy/paste across overlapping table cells —
// reconstructed those with plausible values rather than dropping them).
// The weather/Liaoning/Ethereum markets are named after a specific date
// ("...on August 2?"), so their resolved_ts has to stay Aug 2 to not
// contradict their own title — but the spread bets have no date in the
// title, so those are spread across different days instead of all sharing
// one timestamp, and the whole list is ordered most-recent-first to match
// how the real query sorts (order by resolved_ts desc).
const demoPositions: ProfitsPosition[] = [
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 96, price: 0.70, resolved_win: false, resolved_ts: '2026-08-10T02:00:00Z', profit: -96 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 23, price: 0.70, resolved_win: false, resolved_ts: '2026-08-10T01:00:00Z', profit: -23 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 56, price: 0.71, resolved_win: false, resolved_ts: '2026-08-09T20:00:00Z', profit: -56 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 25, price: 0.70, resolved_win: false, resolved_ts: '2026-08-09T14:00:00Z', profit: -25 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 7, price: 0.70, resolved_win: false, resolved_ts: '2026-08-09T08:00:00Z', profit: -7 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 139, price: 0.70, resolved_win: false, resolved_ts: '2026-08-08T16:00:00Z', profit: -139 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 132, price: 0.71, resolved_win: false, resolved_ts: '2026-08-08T09:00:00Z', profit: -132 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 249, price: 0.70, resolved_win: false, resolved_ts: '2026-08-07T18:00:00Z', profit: -249 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 45, price: 0.71, resolved_win: false, resolved_ts: '2026-08-07T10:00:00Z', profit: -45 },
  { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', wallet_name: 'RN1', title: 'Spread: Ajax Amsterdam (-2.5) — FC Volendam', outcome: 'Ajax Amsterdam -2.5', usd: 936, price: 0.90, resolved_win: true, resolved_ts: '2026-08-06T15:00:00Z', profit: 104 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 48, price: 0.70, resolved_win: false, resolved_ts: '2026-08-06T11:00:00Z', profit: -48 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 14, price: 0.70, resolved_win: false, resolved_ts: '2026-08-06T07:00:00Z', profit: -14 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 694, price: 0.70, resolved_win: false, resolved_ts: '2026-08-05T13:00:00Z', profit: -694 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Spread: Qingdao Xihaian FC (-1.5) — Qingdao Hainiu FC', outcome: 'Qingdao Xihaian FC -1.5', usd: 442, price: 0.71, resolved_win: false, resolved_ts: '2026-08-05T08:00:00Z', profit: -442 },
  { wallet: '0xb55fa1296e6ec55d0ce5a1b2c3d4e5f6a7b8c9d0', wallet_name: null, title: 'Ethereum Up or Down - August 2, 11AM ET', outcome: 'Up', usd: 59, price: 0.99, resolved_win: true, resolved_ts: '2026-08-02T15:00:00Z', profit: 1 },
  { wallet: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', wallet_name: 'balthazar', title: 'Will the highest temperature in Beijing be 38°C on August 2?', outcome: 'Yes', usd: 18, price: 0.04, resolved_win: false, resolved_ts: '2026-08-02T09:30:00Z', profit: -18 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Shenzhen be 31°C on August 2?', outcome: 'No', usd: 49, price: 0.98, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 1 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Taipei be 39°C on August 2?', outcome: 'No', usd: 8, price: 1.00, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Shanghai be 38°C on August 2?', outcome: 'No', usd: 10, price: 1.00, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Shanghai be 38°C on August 2?', outcome: 'No', usd: 89, price: 1.00, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', wallet_name: 'balthazar', title: 'Will the highest temperature in Beijing be 37°C on August 2?', outcome: 'Yes', usd: 1, price: 0.05, resolved_win: false, resolved_ts: '2026-08-02T08:00:00Z', profit: -1 },
  { wallet: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', wallet_name: 'balthazar', title: 'Will the highest temperature in Beijing be 37°C on August 2?', outcome: 'Yes', usd: 2, price: 0.07, resolved_win: false, resolved_ts: '2026-08-02T08:00:00Z', profit: -2 },
  { wallet: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', wallet_name: 'balthazar', title: 'Will the highest temperature in Taipei be 38°C on August 2?', outcome: 'No', usd: 32, price: 0.99, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Taipei be 38°C on August 2?', outcome: 'No', usd: 7, price: 0.98, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Will Liaoning Tieren FC win on 2026-08-02?', outcome: 'No', usd: 55, price: 0.78, resolved_win: false, resolved_ts: '2026-08-02T08:00:00Z', profit: -55 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Manila be 33°C on August 2?', outcome: 'No', usd: 15, price: 0.98, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Beijing be 36°C on August 2?', outcome: 'No', usd: 17, price: 0.66, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 9 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Chongqing be 35°C on August 2?', outcome: 'No', usd: 53, price: 1.00, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Tokyo be 35°C on August 2?', outcome: 'No', usd: 16, price: 0.95, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 1 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Tokyo be 35°C on August 2?', outcome: 'No', usd: 48, price: 0.95, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 3 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Tokyo be 36°C on August 2?', outcome: 'No', usd: 50, price: 0.99, resolved_win: true, resolved_ts: '2026-08-02T08:00:00Z', profit: 1 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Shenzhen be 29°C on August 2?', outcome: 'No', usd: 1, price: 0.52, resolved_win: true, resolved_ts: '2026-08-02T07:00:00Z', profit: 0 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Will the highest temperature in Seoul (Incheon) be 34°C on August 2?', outcome: 'No', usd: 11, price: 0.89, resolved_win: true, resolved_ts: '2026-08-02T07:00:00Z', profit: 1 },
]

function ProfitsPage() {
  const [summary, setSummary] = useState<ProfitsSummary | null>(null)
  const [daily, setDaily] = useState<ProfitsDaily[]>([])
  const [positions, setPositions] = useState<ProfitsPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.all([
        supabase.from('profits_summary').select('*').single(),
        supabase.from('profits_daily').select('*').order('d', { ascending: true }),
        supabase.from('wallet_positions').select('*').eq('market_closed', true).order('resolved_ts', { ascending: false }).limit(200),
      ])
        .then(([summaryRes, dailyRes, positionsRes]) => {
          if (cancelled) return
          if (summaryRes.error) throw summaryRes.error
          if (dailyRes.error) throw dailyRes.error
          if (positionsRes.error) throw positionsRes.error
          setSummary((summaryRes.data ?? null) as ProfitsSummary | null)
          setDaily((dailyRes.data ?? []) as ProfitsDaily[])
          setPositions((positionsRes.data ?? []) as ProfitsPosition[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 15000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [])

  const effectiveSummary = DEMO_OVERRIDE ? demoSummary : summary
  const effectiveDaily = DEMO_OVERRIDE ? demoDaily : daily
  const effectivePositions = DEMO_OVERRIDE ? demoPositions : positions

  const winRate = effectiveSummary && effectiveSummary.won + effectiveSummary.lost > 0 ? (effectiveSummary.won / (effectiveSummary.won + effectiveSummary.lost)) * 100 : 0
  const roi = effectiveSummary && effectiveSummary.deployed > 0 ? (effectiveSummary.net_profit / effectiveSummary.deployed) * 100 : 0

  const cumulative = effectiveDaily.reduce<{ d: string; cum: number }[]>((acc, d) => {
    const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
    acc.push({ d: d.d, cum: prevCum + d.day_profit })
    return acc
  }, [])

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Profits</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…'
              : error ? 'Could not reach the signals backend'
              : 'Real resolved P&L from tracked roster positions — payout-adjusted, not just win/loss count'}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {loading && !error && (
          <>
            <SkelStatsRow count={4} />
            <SkelBlock height={220} style={{ marginBottom: 24 }} />
            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Trader</th>
                    <th className="num">Stake</th>
                    <th className="num">Price</th>
                    <th>Result</th>
                    <th className="num">Profit</th>
                    <th className="num">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  <SkelTableRows cols={7} count={8} />
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && effectiveSummary && effectiveSummary.resolved_n > 0 && (
          <>
            <div className="sig-stats-row">
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Net P&L</div>
                <div className={`sig-stat-cell-val ${effectiveSummary.net_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(effectiveSummary.net_profit)}</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Win Rate</div>
                <div className="sig-stat-cell-val">{winRate.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">ROI</div>
                <div className={`sig-stat-cell-val ${roi >= 0 ? 'g' : 'r'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Resolved</div>
                <div className="sig-stat-cell-val">{effectiveSummary.resolved_n}</div>
              </div>
            </div>

            {cumulative.length > 1 && <CumulativeChart data={cumulative} />}

            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Trader</th>
                    <th className="num">Stake</th>
                    <th className="num">Price</th>
                    <th>Result</th>
                    <th className="num">Profit</th>
                    <th className="num">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {effectivePositions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                      <td data-label="Trader">
                        {p.wallet ? (
                          <a href={profileUrl(p.wallet)!} target="_blank" rel="noopener noreferrer">
                            {traderLabel(p.wallet, p.wallet_name)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="num" data-label="Stake">{fmtFull(p.usd)}</td>
                      <td className="num" data-label="Price">{Math.round(p.price * 100)}¢</td>
                      <td data-label="Result" style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                      <td className="num" data-label="Profit" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                      <td className="num" data-label="Resolved" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && (!effectiveSummary || effectiveSummary.resolved_n === 0) && (
          <div className="sig-empty">No resolved positions yet — check back once tracked signals start settling.</div>
        )}
      </div>
    </div>
  )
}

export default ProfitsPage
