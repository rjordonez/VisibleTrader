type Position = { size?: number; invested: number; avgPrice: number; curPrice: number; pnl: number }
function positionSize(trade: Position) {
  return trade.size != null && Number.isFinite(trade.size) && trade.size >= 0
    ? trade.size : trade.avgPrice > 0 ? trade.invested / trade.avgPrice : 0
}
export function replayValue(trade: Position, price: number) {
  return positionSize(trade) * price
}
// Replay price moves at current size, anchored to the source P&L snapshot.
export function replayPnl(trade: Position, price: number) {
  return trade.pnl + positionSize(trade) * (price - trade.curPrice)
}

// Only observations already reached by the cursor may affect the scale.
export function replayBounds(values: number[]) {
  let low = Infinity, high = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    low = Math.min(low, value); high = Math.max(high, value)
  }
  if (!Number.isFinite(low)) return { min: 0, max: 1 }
  const padding = Math.max((high - low) * .12, Math.abs(high) * .025, 1)
  return { min: Math.max(0, low - padding), max: high + padding }
}
