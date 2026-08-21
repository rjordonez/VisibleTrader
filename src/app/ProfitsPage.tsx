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
const demoSummary: ProfitsSummary = { resolved_n: 1420, won: 780, lost: 640, deployed: 395000, net_profit: 42750 }
const demoDaily: ProfitsDaily[] = [
  { d: '2026-05-30', day_profit: -2940 }, { d: '2026-05-31', day_profit: -764 },
  { d: '2026-06-01', day_profit: 1714 }, { d: '2026-06-02', day_profit: 1040 },
  { d: '2026-06-03', day_profit: -2158 }, { d: '2026-06-04', day_profit: -2704 },
  { d: '2026-06-05', day_profit: 445 }, { d: '2026-06-06', day_profit: 1553 },
  { d: '2026-06-07', day_profit: 611 }, { d: '2026-06-08', day_profit: -581 },
  { d: '2026-06-09', day_profit: 3495 }, { d: '2026-06-10', day_profit: 1391 },
  { d: '2026-06-11', day_profit: 1880 }, { d: '2026-06-12', day_profit: 1715 },
  { d: '2026-06-13', day_profit: 2424 }, { d: '2026-06-14', day_profit: 353 },
  { d: '2026-06-15', day_profit: -1851 }, { d: '2026-06-16', day_profit: 883 },
  { d: '2026-06-17', day_profit: -1250 }, { d: '2026-06-18', day_profit: 2511 },
  { d: '2026-06-19', day_profit: -662 }, { d: '2026-06-20', day_profit: -1028 },
  { d: '2026-06-21', day_profit: 2443 }, { d: '2026-06-22', day_profit: -380 },
  { d: '2026-06-23', day_profit: -1080 }, { d: '2026-06-24', day_profit: 2467 },
  { d: '2026-06-25', day_profit: -2643 }, { d: '2026-06-26', day_profit: 1295 },
  { d: '2026-06-27', day_profit: -457 }, { d: '2026-06-28', day_profit: -2810 },
  { d: '2026-06-29', day_profit: 3468 }, { d: '2026-06-30', day_profit: 3382 },
  { d: '2026-07-01', day_profit: 2642 }, { d: '2026-07-02', day_profit: 2626 },
  { d: '2026-07-03', day_profit: 2217 }, { d: '2026-07-04', day_profit: 696 },
  { d: '2026-07-05', day_profit: -1238 }, { d: '2026-07-06', day_profit: 802 },
  { d: '2026-07-07', day_profit: 2354 }, { d: '2026-07-08', day_profit: 1594 },
  { d: '2026-07-09', day_profit: -1623 }, { d: '2026-07-10', day_profit: 3210 },
  { d: '2026-07-11', day_profit: -1857 }, { d: '2026-07-12', day_profit: 689 },
  { d: '2026-07-13', day_profit: 496 }, { d: '2026-07-14', day_profit: -895 },
  { d: '2026-07-15', day_profit: 1600 }, { d: '2026-07-16', day_profit: 924 },
  { d: '2026-07-17', day_profit: 2716 }, { d: '2026-07-18', day_profit: 3181 },
  { d: '2026-07-19', day_profit: 1664 }, { d: '2026-07-20', day_profit: 1648 },
  { d: '2026-07-21', day_profit: -701 }, { d: '2026-07-22', day_profit: 1116 },
  { d: '2026-07-23', day_profit: -2285 }, { d: '2026-07-24', day_profit: 2181 },
  { d: '2026-07-25', day_profit: -2102 }, { d: '2026-07-26', day_profit: 2894 },
  { d: '2026-07-27', day_profit: -233 }, { d: '2026-07-28', day_profit: -2232 },
  { d: '2026-07-29', day_profit: -1417 }, { d: '2026-07-30', day_profit: 3360 },
  { d: '2026-07-31', day_profit: 591 }, { d: '2026-08-01', day_profit: 1490 },
  { d: '2026-08-02', day_profit: -2486 }, { d: '2026-08-03', day_profit: 743 },
  { d: '2026-08-04', day_profit: 2752 }, { d: '2026-08-05', day_profit: 1211 },
  { d: '2026-08-06', day_profit: 803 }, { d: '2026-08-07', day_profit: -2441 },
  { d: '2026-08-08', day_profit: 1779 }, { d: '2026-08-09', day_profit: 2519 },
]

// Varied mix of markets/traders/amounts so this doesn't read as one repeated
// bet — the whole list is ordered most-recent-first to match how the real
// query sorts (order by resolved_ts desc).
const demoPositions: ProfitsPosition[] = [
  { wallet: '0x91cd44a1f2e8b3d75c60fa192e8d4b7c3a95f210', wallet_name: 'HomeRunHazard', title: 'Lakers vs. Celtics', outcome: 'Lakers', usd: 420, price: 0.62, resolved_win: true, resolved_ts: '2026-08-20T09:00:00Z', profit: 257 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Cincinnati Open: Aryna Sabalenka vs Sara Bejlek', outcome: 'Sara Bejlek', usd: 180, price: 0.31, resolved_win: false, resolved_ts: '2026-08-20T07:00:00Z', profit: -180 },
  { wallet: '0x6f3d81c2a94e57b0912fd4e6a8c3b57910de204a', wallet_name: 'curie', title: 'Bitcoin Up or Down - August 19, 8:00PM-12:00AM ET', outcome: 'Down', usd: 950, price: 0.94, resolved_win: true, resolved_ts: '2026-08-20T04:00:00Z', profit: 61 },
  { wallet: '0x7e1f9c90800e42806e24f3a8b1d5c962e70af341', wallet_name: null, title: 'Dota 2: Iron Wing vs Team Spirit - Game 1 Winner', outcome: 'Iron Wing', usd: 310, price: 0.68, resolved_win: true, resolved_ts: '2026-08-20T01:00:00Z', profit: 146 },
  { wallet: '0x4b8a5f6d2e1c9073ab5f8d0e3c6a97d1240fb856', wallet_name: 'dips.', title: 'Will FC Dallas win on 2026-08-19?', outcome: 'Yes', usd: 244, price: 0.97, resolved_win: false, resolved_ts: '2026-08-19T22:00:00Z', profit: -244 },
  { wallet: '0x2c9e5d871a4f36b0e8c72d05f9b3a641758ce902', wallet_name: 'bahibahibahi', title: 'US-Iran 60 day negotiation period extended?', outcome: 'No', usd: 1200, price: 0.87, resolved_win: true, resolved_ts: '2026-08-19T08:00:00Z', profit: 179 },
  { wallet: '0x5a7c3e982f16d40b9e2a8c05d371f6b942a0e857', wallet_name: 'UpTheBlues', title: 'Colorado Rapids SC vs. Los Angeles FC: O/U 2.5', outcome: 'Under', usd: 129, price: 0.86, resolved_win: false, resolved_ts: '2026-08-19T05:00:00Z', profit: -129 },
  { wallet: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', wallet_name: 'DeepSeekV4.2', title: 'Ethereum Up or Down - August 18, 11PM ET', outcome: 'Up', usd: 90, price: 0.99, resolved_win: true, resolved_ts: '2026-08-19T02:00:00Z', profit: 1 },
  { wallet: '0x3d6f8b204e91c7a5028fd63b9a4c5e871d0af623', wallet_name: 'PASSTHEMONEY', title: 'LoL: LOUD vs paiN Gaming', outcome: 'paiN Gaming', usd: 175, price: 0.32, resolved_win: false, resolved_ts: '2026-08-18T10:00:00Z', profit: -175 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', wallet_name: 'swisstony', title: 'Real Madrid win market', outcome: 'Yes', usd: 560, price: 0.74, resolved_win: true, resolved_ts: '2026-08-18T06:00:00Z', profit: 197 },
  { wallet: '0x8e4a2c609f1b357de08a6f3c9d5b174e2a08c635', wallet_name: 'AV23IUa', title: 'Map Handicap: NAVI (-1.5) vs Legacy (+1.5)', outcome: 'NAVI', usd: 2100, price: 0.58, resolved_win: true, resolved_ts: '2026-08-18T01:00:00Z', profit: 1521 },
  { wallet: '0x9e3ed7b661a903fc97af5c108d3b6e94012fa758', wallet_name: null, title: 'Will the highest temperature in Tokyo be 34°C on August 17?', outcome: 'No', usd: 63, price: 0.71, resolved_win: false, resolved_ts: '2026-08-17T09:00:00Z', profit: -63 },
  { wallet: '0x6d1c92e5a83f047b6e9d3a0c5f871b2934d0e6a7', wallet_name: 'tradecraft', title: 'Fed rate decision — September', outcome: 'No cut', usd: 890, price: 0.81, resolved_win: true, resolved_ts: '2026-08-17T04:00:00Z', profit: 209 },
  { wallet: '0x0f7e2c9d84b135a6f087dc2e5931a4b708fce561', wallet_name: 'NeoOracle', title: 'Spread: FC Dallas (-1.5) — Real Salt Lake', outcome: 'Real Salt Lake', usd: 1190, price: 0.55, resolved_win: false, resolved_ts: '2026-08-17T00:00:00Z', profit: -1190 },
  { wallet: '0xb5257c069356192959e2f4d0a83c671de908fa32', wallet_name: null, title: 'Will Team Falcons Win the CS2 EWC 2026?', outcome: 'Yes', usd: 1178, price: 0.19, resolved_win: true, resolved_ts: '2026-08-16T10:00:00Z', profit: 5022 },
  { wallet: '0x1c4e8a70d3f2965b0e7ac4d1f386b9e025d7a4c8', wallet_name: 'ojg', title: 'Cancun: Alan Magadan vs Alex Hernandez', outcome: 'Alan Magadan', usd: 114, price: 0.91, resolved_win: false, resolved_ts: '2026-08-16T02:00:00Z', profit: -114 },
  { wallet: '0xd1436fd149ffe4ec20f39a6c8b05d371e924fa60', wallet_name: null, title: 'Will Bitcoin reach $72,000 August 17-23?', outcome: 'Yes', usd: 635, price: 0.23, resolved_win: true, resolved_ts: '2026-08-15T09:00:00Z', profit: 2126 },
  { wallet: '0x4f9b1c68a05e372d8f6a90c3b5e1d874f602ac93', wallet_name: 'LUCKYME001', title: 'Seattle Sounders FC vs. Austin FC: O/U 3.5', outcome: 'Under', usd: 271, price: 0.62, resolved_win: false, resolved_ts: '2026-08-15T02:00:00Z', profit: -271 },
  { wallet: '0x7a2d5f893c1e460b9d8f2a6c04b7e315d8a0f942', wallet_name: 'dafei888', title: 'Will Elon Musk post 300-319 tweets from August 14 to August 21, 2026?', outcome: 'No', usd: 299, price: 0.99, resolved_win: true, resolved_ts: '2026-08-14T10:00:00Z', profit: 3 },
  { wallet: '0x5f5ae82d7b0416c3a9f7d6c2e805b1937f4a068c', wallet_name: null, title: 'Los Angeles Dodgers vs. Colorado Rockies', outcome: 'Colorado Rockies', usd: 270, price: 0.43, resolved_win: false, resolved_ts: '2026-08-14T03:00:00Z', profit: -270 },
  { wallet: '0xe1736aa9df058c2b4a06e7c3d195f0b826c4d7e1', wallet_name: 'IL7YXA', title: 'Clarity Act (H.R.3633) signed into law in 2026?', outcome: 'Yes', usd: 176, price: 0.22, resolved_win: true, resolved_ts: '2026-08-13T09:00:00Z', profit: 624 },
  { wallet: '0x2a86d5f931c7e04b8f9a3c60d5e178b924f0a637', wallet_name: 'Trustmebro69', title: 'Minnesota Lynx vs. Golden State Valkyries', outcome: 'Minnesota Lynx', usd: 100, price: 0.95, resolved_win: false, resolved_ts: '2026-08-13T02:00:00Z', profit: -100 },
  { wallet: '0x105499251185035355906fa8c3d61e2b0947f3ac', wallet_name: 'HaileyWelch', title: 'Will the price of Ethereum be above $2,300 on August 20?', outcome: 'Yes', usd: 192, price: 0.14, resolved_win: true, resolved_ts: '2026-08-12T10:00:00Z', profit: 1179 },
  { wallet: '0x38791873984189d5c6a04f2e0b7318d5c9a04f68', wallet_name: null, title: 'Portland Timbers vs. San Diego FC: O/U 5.5', outcome: 'Under', usd: 223, price: 0.89, resolved_win: false, resolved_ts: '2026-08-11T09:00:00Z', profit: -223 },
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
