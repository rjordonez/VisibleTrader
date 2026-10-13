import { useCallback } from 'react'
import posthog from '../lib/posthog'
import { fmtAbbrevSigned } from './helpers'
import { ShareCardModal } from './TraderShareCard'
import { W, H, GREEN, RED, FONT, roundRect, loadImage, fitFont } from './shareCanvas'

// A shareable image of one Journal month: the month's total P&L, a
// calendar with each day's result, and headline stats — same 1080x1350
// canvas, frame and footer style as the trader profile card
// (TraderShareCard.tsx). The footer carries the visibletrader.com/promo
// link so anyone who sees a shared month can find us through it.

export interface JournalShareData {
  monthLabel: string // e.g. "October 2026"
  year: number
  month: number // 0-11
  // Combined (manual + account) P&L per day of the month that has results.
  days: Map<number, number>
  total: number
  daysLogged: number
  profitableDays: number
  bestDay: number | null
}

const FRAME: [string, string] = ['#6370ff', '#4b57f0']
const PROMO_URL = 'visibletrader.com/promo'
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

async function drawMonthCard(canvas: HTMLCanvasElement, d: JournalShareData) {
  await Promise.all([600, 700, 800].map(w => document.fonts.load(`${w} 40px Manrope`).catch(() => [])))
  const icon = await loadImage('/visibletrader-icon.png')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = W
  canvas.height = H
  const accent = d.total > 0 ? GREEN : d.total < 0 ? RED : '#ffffff'

  // Colored frame that the footer sits in.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, FRAME[0])
  bg.addColorStop(1, FRAME[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Dark inner card.
  const cx = 18, cy = 18, cw = W - 36, ch = 1130
  roundRect(ctx, cx, cy, cw, ch, 48)
  ctx.fillStyle = '#0b0c12'
  ctx.fill()

  const pad = 84
  const inner = W - pad * 2

  // Header: month on the left, total P&L on the right.
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#9ca3af'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('My trading month', pad, 128)
  ctx.fillStyle = '#fff'
  fitFont(ctx, d.monthLabel, 800, 64, inner * 0.55)
  ctx.fillText(d.monthLabel, pad, 200)

  const big = fmtAbbrevSigned(d.total)
  ctx.textAlign = 'right'
  ctx.fillStyle = '#9ca3af'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('Month P&L', W - pad, 128)
  ctx.fillStyle = accent
  fitFont(ctx, big, 800, 84, inner * 0.42)
  ctx.fillText(big, W - pad, 204)

  // Calendar grid.
  const firstWeekday = new Date(d.year, d.month, 1).getDay()
  const daysInMonth = new Date(d.year, d.month + 1, 0).getDate()
  const rows = Math.ceil((firstWeekday + daysInMonth) / 7)
  const gap = 12
  const cellW = (inner - gap * 6) / 7
  const gridTop = 300
  const gridBottom = 905
  const cellH = Math.min(cellW, (gridBottom - gridTop - gap * (rows - 1)) / rows)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#6b7080'
  ctx.font = `700 26px ${FONT}`
  WEEKDAYS.forEach((w, i) => ctx.fillText(w, pad + i * (cellW + gap) + cellW / 2, gridTop - 22))

  for (let day = 1; day <= daysInMonth; day++) {
    const idx = firstWeekday + day - 1
    const x = pad + (idx % 7) * (cellW + gap)
    const y = gridTop + Math.floor(idx / 7) * (cellH + gap)
    const amt = d.days.get(day)
    const has = amt !== undefined
    roundRect(ctx, x, y, cellW, cellH, 16)
    ctx.fillStyle = !has ? '#15161f' : amt > 0 ? '#0f2f23' : amt < 0 ? '#36161f' : '#1d1e2a'
    ctx.fill()
    if (has && amt !== 0) {
      ctx.strokeStyle = amt > 0 ? 'rgba(0, 209, 122, 0.35)' : 'rgba(255, 59, 92, 0.35)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.textAlign = 'left'
    ctx.fillStyle = has ? '#d5d7e2' : '#565a6b'
    ctx.font = `700 22px ${FONT}`
    ctx.fillText(String(day), x + 12, y + 32)
    if (has) {
      const label = fmtAbbrevSigned(amt)
      ctx.fillStyle = amt > 0 ? GREEN : amt < 0 ? RED : '#9ca3af'
      fitFont(ctx, label, 800, 26, cellW - 20)
      ctx.fillText(label, x + 10, y + cellH - 14)
    }
  }

  // Stats panel.
  const px = cx + 36, pw = cw - 72, py = 935, ph = 180
  roundRect(ctx, px, py, pw, ph, 36)
  ctx.fillStyle = '#15161f'
  ctx.fill()
  ctx.strokeStyle = '#262838'
  ctx.lineWidth = 2
  ctx.stroke()
  const cols = [
    { label: 'Days logged', value: d.daysLogged.toLocaleString(), color: '#fff' },
    { label: 'Green days', value: d.daysLogged ? `${d.profitableDays}/${d.daysLogged}` : '—', color: '#fff' },
    { label: 'Best day', value: d.bestDay === null ? '—' : fmtAbbrevSigned(d.bestDay), color: d.bestDay !== null && d.bestDay > 0 ? GREEN : d.bestDay !== null && d.bestDay < 0 ? RED : '#fff' },
  ]
  const colW = pw / 3
  cols.forEach((c, i) => {
    const mid = px + colW * i + colW / 2
    if (i) {
      ctx.fillStyle = '#262838'
      ctx.fillRect(px + colW * i, py + 30, 2, ph - 60)
    }
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9ca3af'
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(c.label, mid, py + 70)
    ctx.fillStyle = c.color
    ctx.font = `800 48px ${FONT}`
    ctx.fillText(c.value, mid, py + 134)
  })

  // Footer: logo + the promo link, as big as the space allows.
  const fy = cy + ch + (H - cy - ch) / 2
  ctx.textBaseline = 'middle'
  const iconSize = 110
  if (icon) {
    ctx.save()
    roundRect(ctx, 48, fy - iconSize / 2, iconSize, iconSize, 26)
    ctx.clip()
    ctx.drawImage(icon, 48, fy - iconSize / 2, iconSize, iconSize)
    ctx.restore()
  }
  const textX = icon ? 48 + iconSize + 28 : 48
  ctx.textAlign = 'left'
  ctx.fillStyle = '#fff'
  fitFont(ctx, PROMO_URL, 800, 84, W - 48 - textX)
  ctx.fillText(PROMO_URL, textX, fy + 4)
}

export function JournalShareModal({ data, onClose }: { data: JournalShareData; onClose: () => void }) {
  const draw = useCallback((canvas: HTMLCanvasElement) => drawMonthCard(canvas, data), [data])
  return (
    <ShareCardModal
      draw={draw}
      fileName={`visibletrader-${data.monthLabel.replace(/\s+/g, '-').toLowerCase()}.png`}
      label={`${data.monthLabel} trading journal card`}
      onClose={onClose}
      onAction={method => posthog.capture('journal_month_shared', { method, month: `${data.year}-${String(data.month + 1).padStart(2, '0')}` })}
    />
  )
}
