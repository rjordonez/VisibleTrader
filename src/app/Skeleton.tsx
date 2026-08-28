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

function SkelCircle({ size = 32 }: { size?: number }) {
  return <div className="sig-skel" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} />
}

// Matches .sig-card / .sig-card-dense (icon + title lines + stat rows + tag)
export function SkelCard({ dense = false }: { dense?: boolean }) {
  const iconSize = dense ? 28 : 36
  return (
    <div className={dense ? 'sig-card sig-card-dense' : 'sig-card'}>
      <div className="sig-card-top" style={{ marginBottom: dense ? 10 : 16 }}>
        <div className="sig-skel" style={{ width: iconSize, height: iconSize, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkelBlock height={dense ? 12 : 14} style={{ marginBottom: 6 }} />
          <SkelBlock width="55%" height={dense ? 12 : 14} />
        </div>
      </div>
      {dense ? (
        <>
          <SkelBlock height={11} style={{ marginBottom: 8 }} />
          <SkelBlock height={11} style={{ marginBottom: 8 }} />
          <SkelBlock height={11} width="70%" />
        </>
      ) : (
        <div className="sig-gauge-row">
          <SkelCircle size={88} />
          <div className="sig-stat-col">
            <SkelBlock height={11} style={{ marginBottom: 9 }} />
            <SkelBlock height={11} style={{ marginBottom: 9 }} />
            <SkelBlock height={11} width="70%" />
          </div>
        </div>
      )}
    </div>
  )
}

export function SkelCardGrid({ count = 8, dense = false }: { count?: number; dense?: boolean }) {
  return (
    <div className={dense ? 'sig-grid-dense' : 'sig-grid'}>
      {Array.from({ length: count }).map((_, i) => <SkelCard key={i} dense={dense} />)}
    </div>
  )
}

// Matches .sig-row (ticker list rows: 46px icon | flex mid | auto right)
export function SkelListRow() {
  return (
    <div className="sig-row">
      <SkelCircle size={40} />
      <div className="sig-mid">
        <SkelBlock height={13} width="70%" style={{ marginBottom: 8 }} />
        <SkelBlock height={11} width="45%" />
      </div>
      <div className="sig-right">
        <SkelBlock height={13} width={50} style={{ marginLeft: 'auto', marginBottom: 8 }} />
        <SkelBlock height={11} width={40} style={{ marginLeft: 'auto' }} />
      </div>
    </div>
  )
}

export function SkelList({ count = 6 }: { count?: number }) {
  return (
    <div className="sig-list">
      {Array.from({ length: count }).map((_, i) => <SkelListRow key={i} />)}
    </div>
  )
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

// Matches Home's .sig-hero-row (hero card + top-movers sidebar)
export function SkelHeroRow() {
  return (
    <div className="sig-hero-row">
      <div className="sig-hero">
        <div className="sig-hero-top">
          <div className="sig-skel" style={{ width: 44, height: 44, borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <SkelBlock height={17} style={{ marginBottom: 8 }} />
            <SkelBlock width="40%" height={12} />
          </div>
          <SkelBlock width={70} height={15} />
        </div>
        <div style={{ margin: '16px 0' }}>
          <SkelStatsRow count={4} />
        </div>
        <SkelBlock height={220} style={{ marginBottom: 16 }} />
        <SkelDrillRows count={5} />
      </div>
      <div className="sig-sidebar-col">
        <div className="sig-movers">
          <SkelBlock width={140} height={10} style={{ marginBottom: 12 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sig-mover-row">
              <div className="sig-skel" style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }} />
              <SkelBlock height={12} style={{ flex: 1 }} />
              <SkelBlock width={50} height={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
