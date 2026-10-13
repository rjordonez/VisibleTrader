// Canvas helpers and constants shared by the share-image cards
// (TraderShareCard.tsx, JournalShareCard.tsx).

export const W = 1080
export const H = 1350
export const GREEN = '#00d17a'
export const RED = '#ff3b5c'
export const FONT = "Manrope, system-ui, -apple-system, sans-serif"

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Shrinks the font until `text` fits in `maxWidth`.
export function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number) {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (s > 20 && ctx.measureText(text).width > maxWidth) {
    s -= 2
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  return s
}
