import { useId, useMemo, useState, type CSSProperties } from 'react'
import type { ChartPoint } from './types'
import { fmtSigned } from './helpers'
import './pick-chart.css'

// The hand-drawn SVG chart: a single reveal-animated polyline with a
// pointer/keyboard scrubber and a big current-value readout pinned to the
// right. Shared by the Signals "vetted" cards (ExpertPickCard), the Terminal
// market page (MarketDetailContent's `minimal` chart variant), and both
// cumulative $ P&L charts (Profit Bot's hero, Trader Profile) -- one
// rendering path so all of these stay visually identical instead of
// drifting apart.
// The SVG's viewBox stays 320x104 and stretches to the container via
// preserveAspectRatio="none"; `height` just makes that container taller
// (the Terminal passes a bigger value than the Signals cards' default).
const VB_HEIGHT = 104
// Reserved on the right for the big endpoint-value readout (see
// .expert-pick-plot's margin-right in pick-chart.css) — used here too so the
// dot/selected-value x positions agree with where the SVG itself is drawn.
const RIGHT_RESERVE = 88
// Reserved on the left for $ axis labels, only when axisTicks is passed
// (the cumulative P&L charts) — price charts (cards/Terminal) never set
// this, so their layout is untouched.
const LEFT_RESERVE = 52

interface RawPoint { t: number; v: number }

interface MiniLineChartProps {
  // null while loading, [] (or <2 points) when there's nothing to draw.
  points: RawPoint[] | null
  // Latest real value to show when nothing's hovered -- kept separate from
  // points.at(-1).v since a caller's "current" value can be fresher than
  // its last plotted history point (e.g. a live market price).
  latestValue: number
  // Screen-reader label for what the line represents ("Yes chance",
  // "Cumulative P&L") -- read as "<label>: <formatted value>".
  label: string
  formatValue: (v: number) => { main: string; unit?: string }
  formatTime: (t: number) => string
  error: boolean
  onRetry: () => void
  height?: number
  // CSS custom properties, not a literal color prop -- pick-chart.css reads
  // these with a fallback to the original hardcoded blue, so every existing
  // caller (unset) renders byte-identical to before this was generalized.
  accent?: { line: string; bright: string }
  // $ (or other unit) tick labels drawn along the left edge, at the same
  // y-scale as the plotted line -- only the cumulative P&L charts pass
  // this; price charts stay exactly as they were (no axis at all).
  axisTicks?: { value: number; text: string }[]
  // Wraps the whole thing in a bordered card. Profit Bot's hero chart
  // already sits inside its own card, so it passes false; Trader Profile's
  // chart doesn't have one of its own, so it passes true.
  bordered?: boolean
}

function MiniLineChart({ points: history, latestValue, label, formatValue, formatTime, error, onRetry, height = VB_HEIGHT, accent, axisTicks, bordered }: MiniLineChartProps) {
  const clipId = `expert-chart-reveal-${useId().replace(/:/g, '')}`
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const leftReserve = axisTicks ? LEFT_RESERVE : 0
  const { points, minV, spanV } = useMemo(() => {
    if (!history || history.length < 2) return { points: [] as (RawPoint & { x: number; y: number })[], minV: 0, spanV: 1 }
    const minT = history[0].t
    const spanT = Math.max(1, history[history.length - 1].t - minT)
    const values = history.map(p => p.v)
    const minV = Math.min(...values)
    const spanV = Math.max(0.04, Math.max(...values) - minV)
    return {
      minV, spanV,
      points: history.map(p => ({ ...p, x: 6 + (p.t - minT) / spanT * 308, y: 88 - (p.v - minV) / spanV * 72 })),
    }
  }, [history])
  const line = useMemo(() => points.map(p => `${p.x},${p.y}`).join(' '), [points])
  const endpoint = points.at(-1)
  // More gridlines as the chart gets taller — 3 on the short Signals card,
  // ~6 on the tall Terminal one — evenly spread across the 104-unit viewBox.
  const gridYs = useMemo(() => {
    const rows = Math.max(3, Math.round(height / 52))
    return Array.from({ length: rows }, (_, i) => Math.round(((i + 0.5) / rows) * VB_HEIGHT))
  }, [height])
  // Same x/y mapping formula as the plotted points above, so the dot,
  // hover-selected value, and axis labels all agree with where the line
  // itself is actually drawn.
  const xToLeft = (x: number) => `calc(${leftReserve}px + (100% - ${leftReserve + RIGHT_RESERVE}px) * ${x / 320})`
  const yToTop = (y: number) => `${8 + (y / VB_HEIGHT) * height}px`
  // The dot is drawn as an HTML element, not an SVG <circle>, so it stays a
  // round dot instead of stretching into an ellipse when the viewBox is
  // scaled non-uniformly to fill a wide/tall container.
  const dotStyle = (p: { x: number; y: number }) => ({ left: xToLeft(p.x), top: yToTop(p.y) })
  const selected = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)]
  const displayedValue = formatValue(selected?.v ?? latestValue)
  const selectedTime = selected ? formatTime(selected.t) : undefined
  const accentStyle = accent ? ({ '--pick-chart-color': accent.line, '--pick-chart-color-bright': accent.bright } as CSSProperties) : undefined
  const tickRows = axisTicks?.map(t => ({ ...t, y: 88 - (t.value - minV) / spanV * 72 }))

  return (
    <div className={`expert-pick-chart${bordered ? ' is-bordered' : ''}`} style={{ ...(height === VB_HEIGHT ? undefined : { height }), ...accentStyle }}>
      <div className="expert-pick-plot" style={{ ...(height === VB_HEIGHT ? undefined : { height }), marginLeft: leftReserve || undefined }}>
        {endpoint ? (
          <svg viewBox="0 0 320 104" role="slider" tabIndex={0}
            aria-label={`${label} history. Use arrow keys to explore.`}
            aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selected ? hoverIndex! : points.length - 1}
            aria-valuetext={selected ? `${selectedTime}: ${displayedValue.main}${displayedValue.unit ?? ''}` : `${displayedValue.main}${displayedValue.unit ?? ''} latest`}
            preserveAspectRatio="none"
            onPointerMove={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width * 320
              // Binary search the nearest historical timestamp.
              let lo = 0, hi = points.length - 1
              while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2)
                if (points[mid].x < x) lo = mid + 1
                else hi = mid
              }
              setHoverIndex(lo > 0 && x - points[lo - 1].x < points[lo].x - x ? lo - 1 : lo)
            }}
            onPointerLeave={() => setHoverIndex(null)}
            onPointerCancel={() => setHoverIndex(null)}
            onBlur={() => setHoverIndex(null)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return
              event.preventDefault()
              if (event.key === 'Escape') setHoverIndex(null)
              else if (event.key === 'Home') setHoverIndex(0)
              else if (event.key === 'End') setHoverIndex(points.length - 1)
              else setHoverIndex(index => Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))))
            }}>
            <defs><clipPath id={clipId}><rect className="expert-pick-reveal" x="0" y="0" width="320" height="104" /></clipPath></defs>
            {gridYs.map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} className="expert-pick-gridline" vectorEffect="non-scaling-stroke" />)}
            <g clipPath={`url(#${clipId})`}>
              <polyline points={line} fill="none" stroke={selected ? 'var(--text-faint)' : 'currentColor'} opacity={selected ? 0.25 : 1} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {selected && <>
              <polyline points={points.slice(0, hoverIndex! + 1).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <line x1={selected.x} x2={selected.x} y1="8" y2="96" stroke="currentColor" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            </>}
            </g>
          </svg>
        ) : history === null ? (
          <svg className="expert-pick-chart-skeleton" viewBox="0 0 320 104" aria-label="Loading chart" role="img" preserveAspectRatio="none">
            {gridYs.map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
          </svg>
        ) : <span role="status">{error ? 'Couldn’t load chart' : 'Not enough history yet'}<button type="button" className="expert-chart-retry" onClick={onRetry}>Retry</button></span>}
      </div>
      {tickRows?.map(t => (
        <span key={t.value} className="expert-pick-axis-label" style={{ top: yToTop(t.y) }}>{t.text}</span>
      ))}
      {endpoint && !selected && <span className="expert-pick-endpoint-dot" style={dotStyle(endpoint)} aria-hidden="true" />}
      {selected && <span className="expert-pick-endpoint-dot is-hover" style={dotStyle(selected)} aria-hidden="true" />}
      <strong className="expert-pick-endpoint-price" style={{
        top: yToTop(selected?.y ?? endpoint?.y ?? 52),
        ...(selected ? { left: `calc(${xToLeft(selected.x)} + 12px)`, right: 'auto' } : {}),
      }} aria-label={`${label}: ${displayedValue.main}${displayedValue.unit ?? ''}`}>
        {displayedValue.main}{displayedValue.unit && <small>{displayedValue.unit}</small>}
      </strong>
      {selectedTime && <span className="expert-pick-hover-time">{selectedTime}</span>}
    </div>
  )
}

export function PickChart({ history, outcome, price, error, onRetry, height = VB_HEIGHT }: { history: ChartPoint[] | null; outcome: string; price: number; error: boolean; onRetry: () => void; height?: number }) {
  return (
    <MiniLineChart
      points={history ? history.map(p => ({ t: p.t, v: p.p })) : null}
      latestValue={price}
      label={`${outcome} chance`}
      formatValue={v => ({ main: String(Number((v * 100).toFixed(1))), unit: '%' })}
      formatTime={t => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      error={error}
      onRetry={onRetry}
      height={height}
    />
  )
}

// Same rendering as PickChart above, sized for cumulative $ P&L over days
// instead of a 0-100% market price -- negative values and the day-string
// x-axis both fall out of MiniLineChart's existing min/max normalization
// for free. Colored green/red by whether the series ends up or down.
// Unlike a price chart's short "82.4%" (always ~5 characters), a $ P&L
// figure can run to 6-7+ digits, so this always passes labeled axis ticks
// (a bare unlabeled line reads as meaningless at that scale) and the
// endpoint value's width is no longer hardcoded (see pick-chart.css) --
// both were breaking specifically on wide numbers before this.
export function CumulativePickChart({ data, height = VB_HEIGHT, bordered = false }: { data: { d: string; cum: number }[]; height?: number; bordered?: boolean }) {
  const last = data.at(-1)?.cum ?? 0
  const up = last >= 0
  if (data.length < 2) return null
  const values = data.map(d => d.cum)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  // 4 evenly-spaced rows across the real data range (not forced through
  // $0 -- matches MiniLineChart's own scaling, which is also pure
  // data-range, not zero-anchored).
  const tickCount = 4
  const axisTicks = Array.from({ length: tickCount }, (_, i) => {
    const value = minV + (maxV - minV) * (i / (tickCount - 1))
    return { value, text: fmtSigned(value) }
  }).reverse()
  return (
    <MiniLineChart
      points={data.map((d, i) => ({ t: i, v: d.cum }))}
      latestValue={last}
      label="Cumulative P&L"
      formatValue={v => ({ main: fmtSigned(v) })}
      formatTime={i => {
        const raw = data[Math.round(i)]?.d
        if (!raw) return ''
        const dt = new Date(raw)
        return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }}
      error={false}
      onRetry={() => {}}
      height={height}
      accent={up ? { line: '#00d17a', bright: '#00d17a' } : { line: '#ff3b5c', bright: '#ff3b5c' }}
      axisTicks={axisTicks}
      bordered={bordered}
    />
  )
}
