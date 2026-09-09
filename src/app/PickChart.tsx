import { useId, useMemo, useState } from 'react'
import type { ChartPoint } from './types'
import './pick-chart.css'

// The hand-drawn SVG price chart: a single reveal-animated polyline with a
// pointer/keyboard scrubber and a big current-price readout pinned to the
// right. Shared by the Signals "vetted" cards (ExpertPickCard) and the
// Terminal market page (MarketDetailContent's `minimal` chart variant).
// `history` is null while loading, [] (or <2 points) when there's nothing
// to draw.
// The SVG's viewBox stays 320x104 and stretches to the container via
// preserveAspectRatio="none"; `height` just makes that container taller
// (the Terminal passes a bigger value than the Signals cards' default).
const VB_HEIGHT = 104

export function PickChart({ history, outcome, price, error, onRetry, height = VB_HEIGHT }: { history: ChartPoint[] | null; outcome: string; price: number; error: boolean; onRetry: () => void; height?: number }) {
  const clipId = `expert-chart-reveal-${useId().replace(/:/g, '')}`
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const points = useMemo(() => {
    if (!history || history.length < 2) return []
    const minT = history[0].t
    const spanT = Math.max(1, history[history.length - 1].t - minT)
    const prices = history.map(p => p.p)
    const minP = Math.min(...prices)
    const spanP = Math.max(0.04, Math.max(...prices) - minP)
    return history.map(p => ({ ...p, x: 6 + (p.t - minT) / spanT * 308, y: 88 - (p.p - minP) / spanP * 72 }))
  }, [history])
  const line = useMemo(() => points.map(p => `${p.x},${p.y}`).join(' '), [points])
  const endpoint = points.at(-1)
  // More gridlines as the chart gets taller — 3 on the short Signals card,
  // ~6 on the tall Terminal one — evenly spread across the 104-unit viewBox.
  const gridYs = useMemo(() => {
    const rows = Math.max(3, Math.round(height / 52))
    return Array.from({ length: rows }, (_, i) => Math.round(((i + 0.5) / rows) * VB_HEIGHT))
  }, [height])
  // The dot is drawn as an HTML element, not an SVG <circle>, so it stays a
  // round dot instead of stretching into an ellipse when the viewBox is
  // scaled non-uniformly to fill a wide/tall container.
  const dotStyle = (p: { x: number; y: number }) => ({
    left: `calc((100% - 88px) * ${p.x / 320})`,
    top: `${8 + (p.y / VB_HEIGHT) * height}px`,
  })
  const selected = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)]
  const displayedPrice = Number(((selected?.p ?? price) * 100).toFixed(1))
  const visiblePrice = displayedPrice
  const selectedTime = selected ? new Date(selected.t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined

  return (
    <div className="expert-pick-chart" style={height === VB_HEIGHT ? undefined : { height }}>
      <div className="expert-pick-plot" style={height === VB_HEIGHT ? undefined : { height }}>
        {endpoint ? (
          <svg viewBox="0 0 320 104" role="slider" tabIndex={0}
            aria-label={`${outcome} price history. Use arrow keys to explore.`}
            aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selected ? hoverIndex! : points.length - 1}
            aria-valuetext={selected ? `${selectedTime}: ${displayedPrice}%` : `${displayedPrice}% latest`}
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
            {gridYs.map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} className="expert-pick-gridline" />)}
            <g clipPath={`url(#${clipId})`}>
              <polyline points={line} fill="none" stroke={selected ? 'var(--text-faint)' : 'currentColor'} opacity={selected ? 0.25 : 1} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {selected && <>
              <polyline points={points.slice(0, hoverIndex! + 1).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <line x1={selected.x} x2={selected.x} y1="8" y2="96" stroke="currentColor" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            </>}
            </g>
          </svg>
        ) : history === null ? (
          <svg className="expert-pick-chart-skeleton" viewBox="0 0 320 104" aria-label="Loading price chart" role="img" preserveAspectRatio="none">
            {gridYs.map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} />)}
          </svg>
        ) : <span role="status">{error ? 'Couldn’t load chart' : 'Not enough price history yet'}<button type="button" className="expert-chart-retry" onClick={onRetry}>Retry</button></span>}
      </div>
      {endpoint && !selected && <span className="expert-pick-endpoint-dot" style={dotStyle(endpoint)} aria-hidden="true" />}
      {selected && <span className="expert-pick-endpoint-dot is-hover" style={dotStyle(selected)} aria-hidden="true" />}
      <strong className="expert-pick-endpoint-price" style={{
        top: `${8 + (selected?.y ?? endpoint?.y ?? 52) / VB_HEIGHT * height}px`,
        ...(selected ? { left: `calc((100% - 88px) * ${selected.x / 320} + 12px)`, right: 'auto' } : {}),
      }} aria-label={`${outcome} chance: ${displayedPrice}%`}>
        {visiblePrice}<small>%</small>
      </strong>
      {selectedTime && <span className="expert-pick-hover-time">{selectedTime}</span>}
    </div>
  )
}
