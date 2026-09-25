import { useEffect, useRef, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { fmtAbbrev, fmtAbbrevSigned } from './helpers'

// A shareable image of a trader's profile: their P&L curve and headline
// stats on a dark card, with a VisibleTrader-branded footer bar. Drawn
// straight onto a <canvas> (no html-to-image dependency) at 1080x1350, the
// 4:5 size Instagram/TikTok/X all display uncropped.

export interface TraderShareData {
  wallet: string
  name: string
  netProfit: number
  deployed: number
  winRate: number
  resolved: number
  cumulative: { d: string; cum: number }[]
}

const W = 1080
const H = 1350
// Each trader gets one of these for the frame + avatar, picked from their
// wallet so the same trader always gets the same color. [base, darker, lighter]
const THEMES: [string, string, string][] = [
  ['#6370ff', '#4b57f0', '#9aa3ff'],
  ['#2f80ff', '#1f63d6', '#7fb2ff'],
  ['#0ea5b7', '#0b8494', '#67d7e4'],
  ['#8b5cf6', '#6d3fe0', '#b9a0fb'],
  ['#ec4899', '#c92f7c', '#f59ac4'],
  ['#f97316', '#d85c08', '#fcae78'],
  ['#14b87a', '#0e9161', '#6fdcb2'],
]
function themeFor(wallet: string) {
  let h = 0
  for (const ch of wallet.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return THEMES[h % THEMES.length]
}
const GREEN = '#00d17a'
const RED = '#ff3b5c'
const FONT = "Manrope, system-ui, -apple-system, sans-serif"

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Shrinks the font until `text` fits in `maxWidth`.
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number) {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (s > 20 && ctx.measureText(text).width > maxWidth) {
    s -= 2
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  return s
}

async function drawCard(canvas: HTMLCanvasElement, d: TraderShareData) {
  // Weights the page itself might never have used, so they may not be loaded.
  await Promise.all([600, 700, 800].map(w => document.fonts.load(`${w} 40px Manrope`).catch(() => [])))
  const icon = await loadImage('/visibletrader-icon.png')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = W
  canvas.height = H
  const up = d.netProfit >= 0
  const accent = up ? GREEN : RED
  const [base, dark, light] = themeFor(d.wallet)

  // Colored frame that the footer sits in.
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, base)
  bg.addColorStop(1, dark)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Dark inner card.
  const cx = 18, cy = 18, cw = W - 36, ch = 1130
  roundRect(ctx, cx, cy, cw, ch, 48)
  ctx.fillStyle = '#0b0c12'
  ctx.fill()

  // Header: avatar initial, name, tag, date.
  const pad = 84
  const initial = (d.name.replace(/^0x/i, '')[0] ?? '?').toUpperCase()
  ctx.beginPath()
  ctx.arc(pad + 56, 140, 56, 0, Math.PI * 2)
  const av = ctx.createLinearGradient(pad, 84, pad + 112, 196)
  av.addColorStop(0, base)
  av.addColorStop(1, light)
  ctx.fillStyle = av
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = `800 54px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initial, pad + 56, 142)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const dateText = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  ctx.font = `600 30px ${FONT}`
  const dateW = ctx.measureText(dateText).width
  ctx.fillStyle = '#6b7080'
  ctx.textAlign = 'right'
  ctx.fillText(dateText, cx + cw - 48, 151)
  ctx.textAlign = 'left'

  const nameX = pad + 140
  fitFont(ctx, d.name, 800, 52, cx + cw - 48 - dateW - 32 - nameX)
  ctx.fillStyle = '#fff'
  ctx.fillText(d.name, nameX, 158)

  // P&L curve.
  const gx = cx + 30, gw = cw - 60, gy = 250, gh = 430
  const pts = d.cumulative
  if (pts.length > 1) {
    const vals = pts.map(p => p.cum)
    const min = Math.min(...vals), max = Math.max(...vals)
    const span = Math.max(1, max - min)
    const xy = pts.map((p, i) => [gx + (i / (pts.length - 1)) * gw, gy + gh - ((p.cum - min) / span) * gh] as const)

    ctx.beginPath()
    xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.lineTo(gx + gw, gy + gh + 30)
    ctx.lineTo(gx, gy + gh + 30)
    ctx.closePath()
    const fill = ctx.createLinearGradient(0, gy, 0, gy + gh + 30)
    fill.addColorStop(0, up ? 'rgba(0, 209, 122, 0.28)' : 'rgba(255, 59, 92, 0.28)')
    fill.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = fill
    ctx.fill()

    ctx.beginPath()
    xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.strokeStyle = accent
    ctx.lineWidth = 7
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = accent
    ctx.shadowBlur = 18
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  // Stats panel.
  const px = cx + 36, pw = cw - 72, py = 745, ph = 380
  roundRect(ctx, px, py, pw, ph, 36)
  ctx.fillStyle = '#15161f'
  ctx.fill()
  ctx.strokeStyle = '#262838'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.fillStyle = '#9ca3af'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('Total profit', W / 2, py + 64)

  const roi = d.deployed > 0 ? (d.netProfit / d.deployed) * 100 : 0
  const big = fmtAbbrevSigned(d.netProfit)
  const pill = `${Math.abs(roi).toFixed(1)}% ROI`
  ctx.font = `800 118px ${FONT}`
  const bigW = ctx.measureText(big).width
  ctx.font = `700 32px ${FONT}`
  const pillW = ctx.measureText(pill).width + 76
  const rowX = W / 2 - (bigW + 24 + pillW) / 2
  ctx.textAlign = 'left'
  ctx.font = `800 118px ${FONT}`
  ctx.fillStyle = accent
  ctx.fillText(big, rowX, py + 190)
  roundRect(ctx, rowX + bigW + 24, py + 128, pillW, 54, 27)
  ctx.fillStyle = up ? 'rgba(0, 209, 122, 0.14)' : 'rgba(255, 59, 92, 0.14)'
  ctx.fill()
  ctx.fillStyle = accent
  // Drawn triangle rather than a ▲ glyph, which some fonts don't have.
  const ax = rowX + bigW + 24 + 24, ay = py + 155
  ctx.beginPath()
  if (roi >= 0) { ctx.moveTo(ax, ay + 9); ctx.lineTo(ax + 22, ay + 9); ctx.lineTo(ax + 11, ay - 10) }
  else { ctx.moveTo(ax, ay - 9); ctx.lineTo(ax + 22, ay - 9); ctx.lineTo(ax + 11, ay + 10) }
  ctx.closePath()
  ctx.fill()
  ctx.font = `700 32px ${FONT}`
  ctx.fillText(pill, ax + 34, py + 166)

  ctx.fillStyle = '#262838'
  ctx.fillRect(px, py + 236, pw, 2)
  const cols = [
    { label: 'Invested', value: fmtAbbrev(d.deployed) },
    { label: 'Win rate', value: `${d.winRate.toFixed(1)}%` },
    { label: 'Resolved trades', value: d.resolved.toLocaleString() },
  ]
  const colW = pw / 3
  cols.forEach((c, i) => {
    const mid = px + colW * i + colW / 2
    if (i) ctx.fillRect(px + colW * i, py + 238, 2, ph - 238)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9ca3af'
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(c.label, mid, py + 290)
    ctx.fillStyle = '#fff'
    ctx.font = `800 44px ${FONT}`
    ctx.fillText(c.value, mid, py + 348)
    ctx.fillStyle = '#262838'
  })

  // Footer: logo + site, as big as the space allows.
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
  fitFont(ctx, 'visibletrader.com', 800, 96, W - 48 - textX)
  ctx.fillText('visibletrader.com', textX, fy + 4)
}

export function TraderShareModal({ data, onClose }: { data: TraderShareData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [blob, setBlob] = useState<Blob | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    void drawCard(canvas, data).then(() => {
      canvas.toBlob(b => { if (!cancelled) setBlob(b) }, 'image/png')
    })
    return () => { cancelled = true }
  }, [data])

  const fileName = `${data.name.replace(/[^\w-]+/g, '_')}-visibletrader.png`
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  const save = () => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const share = () => {
    if (file) void navigator.share({ files: [file] }).catch(() => {})
  }

  return (
    <div className="sig-modal-backdrop" onClick={onClose}>
      <div className="sig-modal-wrap share-card-wrap" onClick={e => e.stopPropagation()}>
        <button className="sig-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sig-modal share-card-modal">
          <canvas ref={canvasRef} className="share-card-canvas" role="img" aria-label={`${data.name} profile card`} />
          <div className="share-card-actions">
            {canShare && (
              <button type="button" className="share-card-btn" onClick={share} disabled={!blob}>
                <Share2 size={16} aria-hidden="true" /> Share
              </button>
            )}
            <button type="button" className={`share-card-btn ${canShare ? 'is-secondary' : ''}`} onClick={save} disabled={!blob}>
              <Download size={16} aria-hidden="true" /> Save image
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
