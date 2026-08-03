import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import type { ChartPoint, WalletContribution } from './types'
import { signalsTraderStatus, traderLabel, fmtFull } from './helpers'

interface ChartMarker { t: number; p: number; color: string; label: string }

function PriceChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint | ChartMarker }[] }) {
  if (!active || !payload || !payload.length) return null
  const point = payload[0].payload
  // Marker points carry a `label` (see markers below); plain price-history
  // points don't — same Tooltip renders either depending on which series
  // is being hovered.
  if ('label' in point) {
    return <div className="sig-chart-tooltip">{point.label}</div>
  }
  return (
    <div className="sig-chart-tooltip">
      <div className="sig-chart-tooltip-price">{Math.round(point.p * 100)}%</div>
      <div className="sig-chart-tooltip-time">{fmtChartTime(point.t)}</div>
    </div>
  )
}

function fmtChartTime(t: number) {
  return new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function ChartMarkerDot(props: { cx?: number; cy?: number; payload?: ChartMarker }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload) return null
  return <circle cx={cx} cy={cy} r={3.5} fill={payload.color} stroke="var(--bg)" strokeWidth={1.5} />
}

export function PriceChart({ history, wallets }: { history: ChartPoint[]; wallets: WalletContribution[] }) {
  if (history.length < 2) return null
  const times = history.map(h => h.t)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const lastIndex = history.length - 1

  // stepAfter interpolation holds each point's price until the next one —
  // a trader's own recorded buy price can differ slightly from the line's
  // sampled price at that same instant (different data sources, sampling
  // granularity), which read as dots floating off the line entirely once
  // the chart is zoomed in. Snapping the dot's y to the line's own value at
  // that x keeps it visually anchored to the graph; the real buy price
  // still shows in the tooltip on hover.
  const sortedHistory = [...history].sort((a, b) => a.t - b.t)
  const priceOnLineAt = (t: number) => {
    let p = sortedHistory[0].p
    for (const h of sortedHistory) {
      if (h.t > t) break
      p = h.p
    }
    return p
  }

  const markers: ChartMarker[] = wallets
    .map(w => {
      const t = new Date(w.ts).getTime() / 1000
      if (t < minT || t > maxT) return null
      const st = signalsTraderStatus(w)
      return {
        t, p: priceOnLineAt(t), color: st.color,
        label: `${traderLabel(w.wallet, w.wallet_name)} — ${st.label} — ${fmtFull(w.usd)} at ${Math.round(w.price * 100)}¢`,
      }
    })
    .filter((m): m is ChartMarker => m !== null)

  // Zoom the y-axis to where the price actually moved instead of always
  // showing the full 0-100% range — a market sitting in the 80-100% band
  // read as almost a flat line at full range, hiding real movement.
  const prices = [...history.map(h => h.p), ...markers.map(m => m.p)]
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const pricePad = Math.max(0.03, (maxP - minP) * 0.2)
  const domainMin = Math.max(0, minP - pricePad)
  const domainMax = Math.min(1, maxP + pricePad)

  // Only the current/last price gets a dot — mirrors Polymarket's own chart,
  // where the line itself carries the history and a single endpoint marker
  // calls out "this is where it is now."
  const renderEndpointDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    if (index !== lastIndex || cx == null || cy == null) return <g key={`dot-${index}`} />
    return (
      <g key={`dot-${index}`}>
        <circle cx={cx} cy={cy} r={5.5} fill="none" stroke="#2f6fed" strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={3} fill="#2f6fed" stroke="var(--bg)" strokeWidth={1.5} />
      </g>
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t" type="number" domain={[minT, maxT]}
            tickFormatter={fmtChartTime} stroke="var(--text-faint)" fontSize={10}
            tickLine={false} axisLine={false} minTickGap={40}
          />
          <YAxis
            domain={[domainMin, domainMax]} tickCount={5} orientation="right"
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            stroke="var(--text-faint)" fontSize={10}
            tickLine={false} axisLine={false} width={36}
          />
          <Tooltip content={<PriceChartTooltip />} cursor={{ stroke: 'var(--text-faint)', strokeDasharray: '3 3' }} />
          <Line
            type="stepAfter" dataKey="p" stroke="#2f6fed" strokeWidth={1.5}
            dot={renderEndpointDot} isAnimationActive={false}
          />
          <Scatter data={markers} dataKey="p" shape={<ChartMarkerDot />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="sig-chart-legend">
        <span className="sig-chart-legend-item"><span className="sig-chart-dot" style={{ background: '#00d17a' }} />Won / Holding</span>
        <span className="sig-chart-legend-item"><span className="sig-chart-dot" style={{ background: '#ff3b5c' }} />Lost / Exited</span>
        <span className="sig-chart-legend-item"><span className="sig-chart-dot" style={{ background: '#2f6fed' }} />Scalped</span>
      </div>
    </div>
  )
}

export function CumulativeChart({ data }: { data: { d: string; cum: number }[] }) {
  const width = 1000, height = 160, padding = 20
  const values = data.map(d => d.cum)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const xStep = (width - padding * 2) / Math.max(1, data.length - 1)
  const yFor = (v: number) => height - padding - ((v - min) / range) * (height - padding * 2)
  const points = data.map((d, i) => `${padding + i * xStep},${yFor(d.cum)}`).join(' ')
  const last = values[values.length - 1] ?? 0
  const lineColor = last >= 0 ? '#00d17a' : '#ff3b5c'
  return (
    <svg className="sig-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1={padding} y1={yFor(0)} x2={width - padding} y2={yFor(0)} stroke="var(--border)" strokeWidth={1} />
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth={2} />
    </svg>
  )
}
