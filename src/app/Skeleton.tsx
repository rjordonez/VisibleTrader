import type { CSSProperties } from 'react'

/* ── Ghost skeleton placeholders ──
   Every shape below mirrors the real content it stands in for (same grid/
   flex container, same icon/line sizes) so the page never reflows or
   "expands sideways" when real data replaces the skeleton. */

export function SkelBlock({ width = '100%', height = 12, radius = 4, style }: {
  width?: number | string
  height?: number | string
  radius?: number
  style?: CSSProperties
}) {
  return <div className="sig-skel" style={{ width, height, borderRadius: radius, ...style }} />
}

// Matches .lb-row.lb-4col (Trader avatar+name+sub | Market title | 2 stat columns)
export function SkelLbRow() {
  return (
    <div className="lb-row lb-4col">
      <div className="lb-trader">
        <div className="sig-skel" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkelBlock height={14} width="65%" style={{ marginBottom: 6 }} />
          <SkelBlock height={11} width="35%" />
        </div>
      </div>
      <div className="lb-market"><SkelBlock height={14} width="80%" /></div>
      <div className="lb-stats">
        {[0, 1].map(i => (
          <div className="lb-col" key={i}>
            <div className="lb-col-stack">
              <SkelBlock height={14} width={60} style={{ marginLeft: 'auto', marginBottom: 6 }} />
              <SkelBlock height={11} width={45} style={{ marginLeft: 'auto' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Matches .sig-stats-row / .sig-stat-cell
export function SkelStatsRow({ count = 4 }: { count?: number }) {
  return (
    <div className="sig-stats-row">
      {Array.from({ length: count }).map((_, i) => (
        <div className="sig-stat-cell" key={i}>
          <SkelBlock width={70} height={10} style={{ marginBottom: 10 }} />
          <SkelBlock width={90} height={20} />
        </div>
      ))}
    </div>
  )
}

// Matches .sig-table rows — pass the column count of the real <table>.
export function SkelTableRows({ cols, count = 8 }: { cols: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j}><SkelBlock height={12} width={j === 0 ? '85%' : '55%'} /></td>
          ))}
        </tr>
      ))}
    </>
  )
}

// Matches .sig-drill-row (contributing-trader rows)
export function SkelDrillRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sig-skel-row">
          <SkelBlock width={100} height={12} />
          <SkelBlock height={12} style={{ flex: 1 }} />
          <SkelBlock width={60} height={12} />
        </div>
      ))}
    </>
  )
}
