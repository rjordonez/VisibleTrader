import { useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceDot, ReferenceLine,
} from 'recharts'
import type { ChartPoint, WalletContribution } from './types'
import { signalsTraderStatus } from './helpers'

interface ChartMarker { t: number; p: number; color: string }

function fmtChartTime(t: number) {
  return new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function PriceChart({ history, wallets }: { history: ChartPoint[]; wallets: WalletContribution[] }) {
  const [hoverT, setHoverT] = useState<number | null>(null)
  if (history.length < 2) return null
  const times = history.map(h => h.t)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)

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
      return { t, p: priceOnLineAt(t), color: st.color }
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
  // calls out "this is where it is now." Pinned via ReferenceDot (a single
  // element at one specific coordinate) rather than Line's per-point `dot`
  // callback — that callback gets invoked once for every data point (not
  // just on hover), and something about it rendering-then-self-suppressing
  // for all but the last point was leaving visible artifacts on markets
  // with many points, even with no hover involved. ReferenceDot sidesteps
  // that mechanism entirely.
  const endpoint = sortedHistory[sortedHistory.length - 1]

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          onMouseMove={(state: { activeLabel?: string | number }) => {
            if (state.activeLabel == null) return
            const t = Number(state.activeLabel)
            if (!Number.isNaN(t)) setHoverT(t)
          }}
          onMouseLeave={() => setHoverT(null)}
        >
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
          <Line
            type="stepAfter" dataKey="p" stroke="#2f6fed" strokeWidth={1.5}
            dot={false} activeDot={false} isAnimationActive={false}
          />
          {markers.map((m, i) => (
            <ReferenceDot key={i} x={m.t} y={m.p} r={3.5} fill={m.color} stroke="var(--bg)" strokeWidth={1.5} ifOverflow="extendDomain" />
          ))}
          <ReferenceDot x={endpoint.t} y={endpoint.p} r={5.5} fill="none" stroke="#2f6fed" strokeWidth={1.5} ifOverflow="extendDomain" />
          <ReferenceDot x={endpoint.t} y={endpoint.p} r={3} fill="#2f6fed" stroke="var(--bg)" strokeWidth={1.5} ifOverflow="extendDomain" />
          {hoverT != null && (
            <>
              <ReferenceLine x={hoverT} stroke="var(--text-faint)" strokeDasharray="3 3" ifOverflow="extendDomain" />
              <ReferenceDot
                x={hoverT} y={priceOnLineAt(hoverT)} r={5} fill="#2f6fed" stroke="var(--bg)" strokeWidth={2}
                ifOverflow="extendDomain"
                label={{
                  value: `${Math.round(priceOnLineAt(hoverT) * 100)}%`,
                  position: 'top', offset: 10,
                  fill: 'var(--text)', fontSize: 12, fontWeight: 600,
                }}
              />
            </>
          )}
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

function fmtCum(v: number) {
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function CumulativeChart({ data }: { data: { d: string; cum: number }[] }) {
  const [hoverI, setHoverI] = useState<number | null>(null)
  if (data.length < 2) return null

  const chartData = data.map((d, i) => ({ i, cum: d.cum, d: d.d }))
  const values = data.map(d => d.cum)
  const minV = Math.min(0, ...values)
  const maxV = Math.max(0, ...values)
  const pad = Math.max(1, (maxV - minV) * 0.1)
  const domainMin = minV - pad
  const domainMax = maxV + pad
  const lastIndex = chartData.length - 1
  const last = values[values.length - 1] ?? 0
  const lineColor = last >= 0 ? '#00d17a' : '#ff3b5c'

  // `d` is a plain day-string ("2026-08-01") for the Profits summary but not
  // always a parseable date elsewhere it's reused — fall back to the raw
  // value rather than showing "Invalid Date" on the axis.
  const fmtTick = (i: number) => {
    const raw = data[Math.round(i)]?.d
    if (!raw) return ''
    const dt = new Date(raw)
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const hoverPoint = hoverI != null ? chartData[hoverI] : null

  return (
    <div style={{ marginBottom: 24 }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          onMouseMove={(state: { activeLabel?: string | number }) => {
            if (state.activeLabel == null) return
            const i = Math.round(Number(state.activeLabel))
            if (!Number.isNaN(i)) setHoverI(i)
          }}
          onMouseLeave={() => setHoverI(null)}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="i" type="number" domain={[0, lastIndex]}
            tickFormatter={fmtTick} stroke="var(--text-faint)" fontSize={10}
            tickLine={false} axisLine={false} minTickGap={40}
          />
          <YAxis
            domain={[domainMin, domainMax]} tickCount={5} orientation="right"
            tickFormatter={fmtCum}
            stroke="var(--text-faint)" fontSize={10}
            tickLine={false} axisLine={false} width={64}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Line
            type="monotone" dataKey="cum" stroke={lineColor} strokeWidth={1.5}
            dot={false} activeDot={false} isAnimationActive={false}
          />
          <ReferenceDot x={lastIndex} y={last} r={5.5} fill="none" stroke={lineColor} strokeWidth={1.5} ifOverflow="extendDomain" />
          <ReferenceDot x={lastIndex} y={last} r={3} fill={lineColor} stroke="var(--bg)" strokeWidth={1.5} ifOverflow="extendDomain" />
          {hoverPoint && (
            <>
              <ReferenceLine x={hoverPoint.i} stroke="var(--text-faint)" strokeDasharray="3 3" ifOverflow="extendDomain" />
              <ReferenceDot
                x={hoverPoint.i} y={hoverPoint.cum} r={5} fill={lineColor} stroke="var(--bg)" strokeWidth={2}
                ifOverflow="extendDomain"
                label={{
                  value: fmtCum(hoverPoint.cum),
                  position: 'top', offset: 10,
                  fill: 'var(--text)', fontSize: 12, fontWeight: 600,
                }}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
